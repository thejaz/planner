import { Modal } from 'obsidian';
import type { Controller } from '../controller';
import { message } from './text';
import { isChange } from '../storage/journal';
import { WAITING } from '../core/summary-totals';

export interface ActionResult {
  outcome?: 'success' | 'unchanged' | 'warning';
  message: string;
  details?: string[];
}

/** Keep the accessible name short; hover help must not replace the button name. */
export function help(element: HTMLElement, text: string): void {
  element.title = text;
  element.setAttribute('aria-description', text);
}

let accessibleLabelSequence = 0;
/** Obsidian treats aria-label as a black hover bubble; keep the name through labelled text instead. */
export function quietSettingsLabels(root: HTMLElement): void {
  for (const element of root.querySelectorAll<HTMLElement>('[aria-label]')) {
    const name = element.getAttribute('aria-label')!;
    // Created in the control's own window (Settings may be a separate one), then moved beside it.
    const label = root.createSpan({ cls: 'planner-sr-only', text: name,
      attr: { id: `planner-settings-control-label-${++accessibleLabelSequence}` } });
    element.insertAdjacentElement('afterend', label);
    element.dataset.plannerAccessibleName = name;
    element.setAttribute('aria-labelledby', label.id); element.removeAttribute('aria-label');
  }
}

/** Settings may live in their own window; keep its dialogs and focus there. */
export function openSettingsDialog(modal: Modal, trigger: HTMLElement): void {
  const host = trigger.ownerDocument;
  modal.open();
  if (modal.containerEl.ownerDocument !== host || host !== modal.app.workspace.containerEl.ownerDocument) {
    const active = modal.modalEl.ownerDocument.activeElement;
    const focused = active && modal.modalEl.contains(active) ? active as HTMLElement : null;
    const input = focused?.tagName === 'INPUT' ? focused as HTMLInputElement : null;
    const selection = input && input.selectionStart !== null ? [input.selectionStart, input.selectionEnd!] as const : null;
    host.body.appendChild(modal.containerEl);
    const keys = (event: KeyboardEvent) => {
      if (!modal.containerEl.isConnected) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); modal.close(); }
      if (event.key === 'Tab') {
        const controls = [...modal.modalEl.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(el => el.offsetParent !== null);
        if (controls.length) {
          const index = controls.findIndex(el => el === event.target || el.contains(event.target as Node));
          const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
          event.preventDefault(); event.stopImmediatePropagation(); controls[next]!.focus();
        }
      }
    };
    host.addEventListener('keydown', keys, true);
    const closeHost = () => modal.close();
    host.defaultView?.addEventListener('pagehide', closeHost, { once: true });
    const close = modal.onClose.bind(modal);
    modal.onClose = () => {
      host.removeEventListener('keydown', keys, true); host.defaultView?.removeEventListener('pagehide', closeHost);
      close(); if (trigger.isConnected) trigger.focus({ preventScroll: true });
    };
    (focused ?? modal.modalEl.querySelector<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)'))?.focus();
    if (input && selection) input.setSelectionRange(...selection);
  }
  quietSettingsLabels(modal.contentEl);
  const labels = new MutationObserver(() => quietSettingsLabels(modal.contentEl));
  labels.observe(modal.contentEl, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-label'] });
  const close = modal.onClose.bind(modal);
  modal.onClose = () => { labels.disconnect(); close(); };
}

class SettingsActionDialog extends Modal {
  private started = false;
  constructor(private controller: Controller, private heading: string, private work: () => Promise<ActionResult>, private done: () => void) {
    super(controller.app);
  }
  onOpen(): void {
    if (this.started) return;
    this.started = true;
    this.titleEl.setText(this.heading);
    this.contentEl.addClass('planner-action-result');
    const status = this.contentEl.createEl('p', { text: 'Working…', attr: { role: 'status', 'aria-live': 'polite' } });
    const details = this.contentEl.createEl('ul');
    const close = this.contentEl.createDiv({ cls: 'planner-dialog-buttons' }).createEl('button', { text: 'Close', attr: { type: 'button' } });
    close.onclick = () => this.close();
    void this.work().then(result => {
      status.setText(result.message);
      status.dataset.outcome = result.outcome ?? 'success';
      for (const text of result.details ?? []) details.createEl('li', { text });
      if (!details.childElementCount) details.remove();
    }).catch(error => {
      status.setText(`${this.heading} could not finish. ${message(error)}`);
      status.addClass('planner-error'); status.setAttribute('role', 'alert');
      details.remove();
    }).finally(this.done);
  }
}

/** Report progress and outcomes without adding a confirmation step to routine actions. */
export function actionFeedback(c: Controller, button: HTMLButtonElement, title: string, work: () => Promise<ActionResult>): void {
  if (button.disabled) return;
  button.disabled = true;
  openSettingsDialog(new SettingsActionDialog(c, title, work, () => { button.disabled = false; }), button);
}

/** Show an action's outcome when it is started from outside Settings, without a settings button. */
function showAction(c: Controller, title: string, work: () => Promise<ActionResult>): void {
  actionFeedback(c, createEl('button'), title, work);
}

export function showRebuild(c: Controller): void { showAction(c, 'Rebuild index', () => rebuildResult(c)); }

export async function rebuildResult(c: Controller): Promise<ActionResult> {
  if (c.indexing) return { outcome: 'unchanged', message: 'Planner is already reading your notes.', details: ['No additional rebuild was started. Wait for the current index to finish.'] };
  if (!c.initialized || !c.isAlive) throw new Error('Planner is not ready. Reopen it and try again.');
  await c.index();
  const error = c.issues.get('index');
  if (error) throw new Error(error);
  if (!c.isAlive || !c.indexed) throw new Error('Indexing stopped before it finished.');
  const run = c.performance.indexRuns.at(-1);
  return {
    outcome: c.issues.size ? 'warning' : 'success', message: 'Index rebuilt.',
    details: [
      `${c.days.size.toLocaleString()} daily notes and ${c.summaries.size.toLocaleString()} summaries are indexed.`,
      ...(run ? [`Read ${run.read.toLocaleString()} notes; reused ${run.cached.toLocaleString()} unchanged cached records.`] : []),
      ...(c.issues.size ? [`${c.issues.size} item${c.issues.size === 1 ? ' still needs' : 's still need'} attention in Planner.`] : [])
    ]
  };
}

export function showRetry(c: Controller): void { showAction(c, 'Retry summary update', () => retryResult(c)); }

export async function retryResult(c: Controller): Promise<ActionResult> {
  const pending = () => c.journal.data.operations.filter(o => o.summaryPending && o.state === 'done');
  const before = new Set(pending().map(o => o.id));
  await c.retrySummary();
  const remaining = pending(), completed = [...before].filter(id => !remaining.some(o => o.id === id)).length;
  // Why the remaining edits wait: a paused summary names its differing project totals.
  const waiting = [...c.issues].filter(([key]) => key.startsWith(WAITING)).map(([, text]) => text);
  return {
    outcome: remaining.length || c.issues.has('summary') || waiting.length ? 'warning' : completed ? 'success' : 'unchanged',
    message: remaining.length ? `${remaining.length} summary update${remaining.length === 1 ? '' : 's'} still pending.`
      : completed ? `${completed} pending summary update${completed === 1 ? '' : 's'} completed.` : 'No pending summary updates to retry.',
    details: [...waiting, ...(c.issues.has('summary') ? [c.issues.get('summary')!] : []),
      ...(remaining.length ? ['Review Planner’s attention list. Conflicting records have not been overwritten.'] : [])]
  };
}

export async function undoResult(c: Controller): Promise<ActionResult> {
  if (!c.journal.canUndo) return { outcome: 'unchanged', message: 'Nothing to undo.' };
  const undone = new Set(c.journal.data.operations.filter(o => o.state === 'undone').map(o => o.id));
  await c.undo();
  if (!c.journal.data.operations.some(o => o.state === 'undone' && !undone.has(o.id))) return { outcome: 'unchanged', message: 'Nothing to undo.', details: ['No additional changes were restored.'] };
  return { message: 'Last Planner operation undone.', details: ['Redo is available in Planner.'] };
}

export async function syncResult(c: Controller): Promise<ActionResult> {
  const before = new Set(c.journal.data.operations.map(o => o.id));
  await c.syncProjectRegistrations();
  const operations = c.journal.data.operations.filter(o => !before.has(o.id));
  const notes = new Set(operations.flatMap(o => o.writes.filter(isChange).map(w => w.path)).filter(p => p.endsWith('.md')));
  const issue = c.issues.get('projects');
  return {
    outcome: issue ? 'warning' : operations.length ? 'success' : 'unchanged',
    message: notes.size ? `${notes.size} summary note${notes.size === 1 ? '' : 's'} updated.`
      : issue ? 'No summary notes changed. Some projects still need attention.'
      : operations.length ? 'Project settings synchronized.' : 'Projects and summaries are already synchronized.',
    details: [...(notes.size ? [...notes] : ['No summary notes were changed.']), ...(issue ? [issue] : [])]
  };
}
