import { App, Modal, Setting } from 'obsidian';
import type { Controller, ProjectTransferPreview } from '../controller';
import type { ProjectTransferMode } from '../core/project-transfer';
import { displayMinutes, linesOf } from '../core/model';
import type { Day, Entry } from '../core/model';
import type { ContextSnapshot } from '../core/context';
import type { ShiftDurations } from '../core/changes';
import { contextOptions, contextResult } from '../core/context';
import { markerRange } from '../core/marker-rules';
import { applyPatches, NameTaken } from '../core/changes';
import type { ProjectRemoval } from '../core/project-removal';
import { randomProjectEmoji } from '../core/project-emojis';
import { singleEmojiField } from './emoji-field';
import { message, uiText } from './text';
import { SHORTCUT_HELP } from './shortcuts';
import { correctionChoices } from '../core/plan-correction';
import type { Change } from '../core/model';
import { openSettingsDialog } from './settings-feedback';

/** Dialog actions in one order: Cancel, then the primary action. */
function dialogButtons(parent: HTMLElement, primary: string, cancel: () => void, options: { cls?: string; submit?: boolean } = {}): HTMLButtonElement {
  const buttons = parent.createDiv({ cls: 'planner-dialog-buttons' });
  buttons.createEl('button', { text: 'Cancel', attr: { type: 'button' } }).onclick = cancel;
  return buttons.createEl('button', { text: primary, cls: options.cls ?? 'mod-cta', attr: { type: options.submit === false ? 'button' : 'submit' } });
}
class PlannerModal extends Modal {
  /** Enter anywhere in the dialog runs its primary action, as in the other planner dialogs. */
  protected submitOnEnter(run: () => void): void {
    this.scope.register([], 'Enter', event => { if (event.isComposing) return; event.preventDefault(); run(); return false; });
  }
  open(): void {
    this.contentEl.addClass('planner-dialog'); this.titleEl.addClass('planner-dialog-title'); super.open();
  }
}

export class ManageProjectDialog extends PlannerModal {
  constructor(app: App, private controller: Controller, private code: string) { super(app); }
  onOpen(): void {
    this.titleEl.setText(uiText('Manage project'));
    const form = this.contentEl.createEl('form', { cls: 'planner-project-management planner-project-dialog' });
    const codes = form.createEl('label', { cls: 'planner-field', text: 'Project' });
    const listId = `planner-project-codes-${Date.now()}`;
    const control = codes.createDiv({ cls: 'planner-field-control' });
    const select = control.createEl('input', { type: 'text', value: this.code, attr: { 'aria-label': 'Project to manage', list: listId } });
    const suggestions = codes.createEl('datalist', { attr: { id: listId } });
    for (const code of this.controller.projectCodes()) suggestions.createEl('option', { value: code });
    const transfer = control.createEl('button', { text: 'rename or merge', attr: { type: 'button' } });
    transfer.onclick = () => { this.close(); openSettingsDialog(new ProjectTransferDialog(this.app, this.controller, select.value), transfer); };
    const modes = form.createEl('label', { cls: 'planner-field', text: 'Action' });
    const mode = modes.createEl('select', { attr: { 'aria-label': 'Project removal action' } });
    mode.createEl('option', { value: 'unlink', text: 'Remove attribution; keep activities' });
    mode.createEl('option', { value: 'delete', text: 'Delete project records' });
    const explanation = form.createEl('p', { cls: 'planner-dialog-explanation' });
    const output = form.createDiv({ cls: 'planner-project-removal-preview' });
    const error = form.createEl('p', { cls: 'planner-error', attr: { role: 'alert' } });
    let plan: ProjectRemoval | undefined;
    const reset = () => {
      plan = undefined; output.empty(); error.empty(); gateApply(apply, applyHint, 'preview');
      explanation.setText(mode.value === 'unlink'
        ? 'Keep activity wording, checkboxes and times. Remove this project attribution and subtract its credited minutes from daily and summary work totals. Other project credits and prose stay intact.'
        : 'Remove this project\u0027s activity rows, its part of split activities, and its project totals across daily notes and summaries. Keep other projects and prose. Adjust known daily/SUM records; aggregate-only history stays preserved. Preview every change first.');
    };
    const buttons = form.createDiv({ cls: 'planner-dialog-buttons' });
    const applyHint = buttons.createEl('p', { cls: 'planner-apply-hint', attr: { 'aria-live': 'polite' } });
    const cancel = buttons.createEl('button', { text: 'Cancel', attr: { type: 'button' } }); cancel.onclick = () => this.close();
    const preview = buttons.createEl('button', { text: 'Preview changes', attr: { type: 'submit' } });
    const apply = buttons.createEl('button', { text: 'Apply changes', cls: 'mod-warning', attr: { type: 'button' } });
    select.oninput = reset; mode.onchange = reset; reset();
    form.onsubmit = async event => {
      event.preventDefault(); preview.disabled = true; apply.disabled = true; select.disabled = true; mode.disabled = true; output.empty(); error.empty();
      try {
        plan = await this.controller.previewProjectRemoval(select.value, mode.value as 'unlink' | 'delete');
        output.createEl('p', { text: `${plan.changes.length} notes will change; ${plan.code} will be removed from Settings.` });
        for (const blocker of plan.blockers) {
          const row = output.createEl('p', { text: blocker, cls: 'planner-error' });
          const source = /^(.+\.md)(?::(\d+))?:/.exec(blocker);
          if (source) { const open = row.createEl('button', { text: 'open source', type: 'button' }); open.onclick = () => { void this.controller.openSource(source[1]!, Number(source[2] ?? 1) - 1); }; }
        }
        for (const change of plan.changes) {
          const details = output.createEl('details'); details.createEl('summary', { text: change.path });
          const diff = details.createEl('pre', { cls: 'planner-preview' });
          for (const p of change.patches) {
            if (p.before) diff.createDiv({ text: '- ' + p.before.trimEnd(), cls: 'planner-diff-removed' });
            if (p.after) diff.createDiv({ text: '+ ' + p.after.trimEnd(), cls: 'planner-diff-added' });
          }
          applyPatches(change.base, change.patches);
        }
        gateApply(apply, applyHint, plan.blockers.length > 0 ? 'blocked' : null);
      } catch (e) { error.setText(message(e)); gateApply(apply, applyHint, 'failed'); }
      finally { preview.disabled = false; select.disabled = false; mode.disabled = false; }
    };
    apply.onclick = async () => {
      if (!plan) return; apply.disabled = true; preview.disabled = true; select.disabled = true; mode.disabled = true;
      try { await this.controller.applyProjectRemoval(plan); this.close(); }
      catch (e) { error.setText(message(e)); gateApply(apply, applyHint, 'failed'); }
      finally { preview.disabled = false; select.disabled = false; mode.disabled = false; }
    };
  }
}

/** Why an apply button is unavailable, shown beside it; a disabled button alone leaves the reader guessing. */
const APPLY_REASONS = {
  preview: 'Preview first to see every change, then apply.',
  blocked: 'Fix the problems above, then preview again.',
  failed: 'Fix the problem above, then preview again.',
  unchanged: 'Nothing to apply: the code is unchanged.'
} as const;
/** Enable `apply`, or disable it and show the reason in `hint` and its tooltip. */
function gateApply(apply: HTMLButtonElement, hint: HTMLElement, reason: keyof typeof APPLY_REASONS | null): void {
  const text = reason ? APPLY_REASONS[reason] : '';
  apply.disabled = !!reason; hint.setText(text); apply.title = text;
}
export class ProjectTransferDialog extends PlannerModal {
  constructor(app: App, private controller: Controller, private source: string) { super(app); }
  onOpen(): void {
    this.titleEl.setText('Rename or merge project');
    const form = this.contentEl.createEl('form', { cls: 'planner-project-transfer planner-project-dialog' });
    const sourceField = form.createEl('label', { text: 'Source project', cls: 'planner-field' });
    const source = sourceField.createEl('select', { attr: { 'aria-label': 'Source project' } });
    for (const code of this.controller.projectCodes()) source.createEl('option', { value: code, text: `${this.controller.settings.projectEmojis[code] ?? ''} ${code}`.trim() });
    source.value = this.controller.projectCodes().includes(this.source.toUpperCase()) ? this.source.toUpperCase() : this.controller.projectCodes()[0] ?? '';
    const actionField = form.createEl('label', { text: 'Action', cls: 'planner-field' });
    const action = actionField.createEl('select', { attr: { 'aria-label': 'Project transfer action' } });
    action.createEl('option', { value: 'rename', text: 'Rename to a new code' });
    action.createEl('option', { value: 'merge', text: 'Merge into an existing project' });
    const destination = form.createEl('label', { cls: 'planner-field' });
    const explanation = form.createEl('p', { cls: 'planner-dialog-explanation', text: 'Preview changes to daily notes, summaries and templates. Work totals stay unchanged. A merge keeps the destination emoji and group.' });
    const output = form.createDiv({ cls: 'planner-project-transfer-preview' });
    const error = form.createEl('p', { cls: 'planner-error', attr: { role: 'alert' } });
    const buttons = form.createDiv({ cls: 'planner-dialog-buttons' });
    const applyHint = buttons.createEl('p', { cls: 'planner-apply-hint', attr: { 'aria-live': 'polite' } });
    const cancel = buttons.createEl('button', { text: 'cancel', attr: { type: 'button' } }); cancel.onclick = () => this.close();
    const mergeInstead = buttons.createEl('button', { text: 'merge instead', attr: { type: 'button' } }); mergeInstead.hidden = true;
    const preview = buttons.createEl('button', { text: 'preview', attr: { type: 'submit' } });
    const apply = buttons.createEl('button', { text: 'apply rename', cls: 'mod-cta', attr: { type: 'button' } }); apply.disabled = true;
    let target: HTMLInputElement | HTMLSelectElement, plan: ProjectTransferPreview | undefined;
    const reset = () => { plan = undefined; output.empty(); error.empty(); gateApply(apply, applyHint, 'preview'); mergeInstead.hidden = true; };
    const destinationField = (value = '') => {
      reset(); destination.empty(); const merging = action.value === 'merge';
      destination.appendText(merging ? 'Destination project' : 'New project code');
      target = merging ? destination.createEl('select', { attr: { 'aria-label': 'Destination project' } }) : destination.createEl('input', { type: 'text', attr: { 'aria-label': 'New project code', placeholder: 'e.g. DTF', autocomplete: 'off' } });
      if (merging) {
        const select = target as HTMLSelectElement;
        select.createEl('option', { value: '', text: 'Choose a project' });
        for (const code of this.controller.projectCodes().filter(code => code !== source.value)) select.createEl('option', { value: code, text: `${this.controller.settings.projectEmojis[code] ?? ''} ${code}`.trim() });
      }
      target.value = value; target.oninput = reset; target.onchange = reset;
      apply.setText(merging ? 'apply merge' : 'apply rename');
      explanation.setText(merging
        ? 'Combine project credits while preserving daily SUM and elapsed time. Separate sessions remain separate. The destination keeps its emoji and group.'
        : 'Change complete project references in daily notes, summaries and templates. Amounts, activity descriptions and unrelated text stay unchanged.');
    };
    source.onchange = () => destinationField(); action.onchange = () => destinationField();
    mergeInstead.onclick = () => { const value = target.value.trim().toUpperCase(); action.value = 'merge'; destinationField(value); target.focus(); };
    const lock = (busy: boolean) => { source.disabled = busy; action.disabled = busy; target.disabled = busy; preview.disabled = busy; cancel.disabled = busy; mergeInstead.disabled = busy; };
    form.onsubmit = async event => {
      event.preventDefault(); reset(); lock(true);
      try {
        plan = await this.controller.previewProjectTransfer(source.value, target.value, action.value as ProjectTransferMode);
        mergeInstead.hidden = !(plan.mode === 'rename' && plan.targetExists && plan.source !== plan.target);
        const templates = plan.changes.filter(c => plan!.sources.find(s => s.path === c.path)?.kind === 'template').length;
        output.createEl('p', { text: plan.source === plan.target ? 'This is already the project code. No changes are needed.' : `${plan.changes.length} proposed file changes (${templates} template${templates === 1 ? '' : 's'}).` });
        for (const blocker of plan.blockers) {
          const row = output.createEl('p', { text: `${blocker.path ? `${blocker.path}:${blocker.line + 1}: ` : ''}${blocker.message}`, cls: 'planner-error' });
          if (blocker.path) { const open = row.createEl('button', { text: 'open source', attr: { type: 'button' } }); open.onclick = () => { void this.controller.openSource(blocker.path, blocker.line); }; }
        }
        if (plan.totals.length) {
          const totals = output.createEl('details'); totals.createEl('summary', { text: 'Project totals by record' });
          for (const total of plan.totals) {
            const merged = plan.mode === 'merge' ? ` + ${plan.target} ${displayMinutes(total.target)}` : '';
            totals.createEl('p', { text: `${total.path}: ${plan.source} ${displayMinutes(total.source)}${merged} -> ${plan.target} ${displayMinutes(total.combined)}` });
          }
        }
        for (const change of plan.changes) {
          const details = output.createEl('details'); details.createEl('summary', { text: change.path });
          const diff = details.createEl('pre', { cls: 'planner-preview' });
          for (const line of linesOf(change.base)) {
            const patches = change.patches.filter(p => p.start >= line.start && p.start < line.fullEnd);
            if (!patches.length) continue;
            const before = change.base.slice(line.start, line.fullEnd);
            const after = applyPatches(before, patches.map(p => ({ ...p, start: p.start - line.start, end: p.end - line.start })));
            diff.createDiv({ text: `line ${line.index + 1}`, cls: 'planner-muted' });
            diff.createDiv({ text: '- ' + before.trimEnd(), cls: 'planner-diff-removed' });
            if (after) diff.createDiv({ text: '+ ' + after.trimEnd(), cls: 'planner-diff-added' });
          }
        }
        gateApply(apply, applyHint, plan.source === plan.target ? 'unchanged' : plan.blockers.length > 0 ? 'blocked' : null);
      } catch (e) { error.setText(message(e)); gateApply(apply, applyHint, 'failed'); }
      finally { lock(false); }
    };
    apply.onclick = async () => {
      if (!plan || apply.disabled) return; apply.disabled = true; lock(true);
      try { await this.controller.applyProjectTransfer(plan); this.close(); }
      catch (e) { error.setText(message(e)); gateApply(apply, applyHint, 'failed'); }
      finally { lock(false); }
    };
    destinationField(); target!.focus();
  }
}

export class ChoiceDialog extends PlannerModal {
  private defaultAction = false;
  private actionButton: HTMLButtonElement | undefined;
  focusAction(): this { this.defaultAction = true; return this; }
  open(): void {
    super.open();
    if (this.defaultAction && this.enabled) this.actionButton?.focus();
  }
  constructor(app: App, private heading: string, private body: string,
    private action: string, private accept: () => Promise<void | (() => unknown)>, private preview = '', private enabled = true,
    private extra?: (container: HTMLElement, dialog: ChoiceDialog) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText(uiText(this.heading));
    this.contentEl.createEl('p', { text: this.body });
    if (this.preview) {
      const preview = this.contentEl.createEl('pre', { cls: 'planner-preview' });
      for (const line of this.preview.split('\n')) preview.createSpan({
        text: line + '\n', cls: line.startsWith('+ ') ? 'planner-diff-added' : line.startsWith('- ') ? 'planner-diff-removed' : ''
      });
    }
    this.extra?.(this.contentEl, this);
    const error = this.contentEl.createEl('p', { cls: 'planner-error', attr: { role: 'alert' } });
    const action = dialogButtons(this.contentEl, this.action, () => this.close(), { submit: false });
    this.actionButton = action; action.disabled = !this.enabled;
    if (this.defaultAction && this.enabled) action.autofocus = true;
    action.onclick = async () => {
      action.disabled = true; error.empty();
      try { const after = await this.accept(); this.close(); await after?.(); }
      catch (e) { error.setText(message(e)); action.disabled = !this.enabled; }
    };
  }
}
export class ProjectDialog extends PlannerModal {
  constructor(app: App, private accept: (code: string, emoji?: string) => Promise<void>) { super(app); }
  onOpen(): void {
    this.titleEl.setText(uiText('Add new project'));
    this.contentEl.createEl('p', { text: 'Choose a short code, such as PLN. It will appear in your project chips and in the summary\u0027s Projects section. You can move its summary line later.' });
    const form = this.contentEl.createEl('form');
    const label = form.createEl('label', { cls: 'planner-field', text: 'Project code' });
    const input = label.createEl('input', { type: 'text', attr: { 'aria-label': 'Project code', placeholder: 'e.g. PLN', autocomplete: 'off' } });
    const emoji = singleEmojiField(form.createEl('input', { type: 'text', placeholder: 'Emoji (optional)', attr: { 'aria-label': 'Project emoji' } }));
    const preview = form.createEl('p', { cls: 'planner-input-hint', attr: { 'aria-live': 'polite' } });
    const update = () => preview.setText(`${emoji.value || 'random emoji'} ${input.value.trim().toUpperCase() || 'CODE'} | starts at 0, or uses existing recorded credit`);
    input.addEventListener('input', update); emoji.addEventListener('input', update); update();
    const error = form.createEl('p', { cls: 'planner-error', attr: { role: 'alert' } });
    const submit = dialogButtons(form, 'Add project', () => this.close());
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true;
      try { await this.accept(input.value, emoji.value); this.close(); }
      catch (e) { error.setText(message(e)); }
      finally { submit.disabled = false; }
    };
    input.focus();
  }
}
export class ProjectEmojiDialog extends PlannerModal {
  constructor(app: App, private controller: Controller, private code: string) { super(app); }
  onOpen(): void {
    this.titleEl.setText(`Emoji for ${this.code}`);
    const form = this.contentEl.createEl('form');
    const label = form.createEl('label', { cls: 'planner-field', text: 'Emoji (blank chooses a random emoji)' });
    const input = singleEmojiField(label.createEl('input', { type: 'text', value: this.controller.settings.projectEmojis[this.code] ?? '', attr: { 'aria-label': 'Project emoji' } }));
    const error = form.createEl('p', { cls: 'planner-error', attr: { role: 'alert' } });
    const buttons = form.createDiv({ cls: 'planner-dialog-buttons' });
    const random = buttons.createEl('button', { text: 'random', attr: { type: 'button' } }); random.onclick = () => { input.value = randomProjectEmoji(); input.focus(); };
    const cancel = buttons.createEl('button', { text: 'cancel', attr: { type: 'button' } }); cancel.onclick = () => this.close();
    const submit = buttons.createEl('button', { text: 'save', attr: { type: 'submit' }, cls: 'mod-cta' });
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true; random.disabled = true;
      try { await this.controller.setProjectEmoji(this.code, input.value); this.close(); }
      catch (e) { error.setText(message(e)); }
      finally { submit.disabled = false; random.disabled = false; }
    };
    input.focus();
  }
}
export class UnsavedActivityDialog extends PlannerModal {
  private settled = false;
  constructor(app: App, private accept: (choice: 'save' | 'discard' | 'stay') => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText('Unsaved activity changes');
    this.contentEl.createEl('p', { text: 'Save your changes before leaving this activity?' });
    const buttons = this.contentEl.createDiv({ cls: 'planner-dialog-buttons' });
    for (const [label, choice] of [['Stay', 'stay'], ['Discard', 'discard'], ['Save changes', 'save']] as const) {
      const button = buttons.createEl('button', { text: label, cls: choice === 'save' ? 'mod-cta' : '', attr: { type: 'button' } });
      button.onclick = () => { this.settled = true; this.accept(choice); this.close(); };
    }
  }
  onClose(): void { if (!this.settled) this.accept('stay'); }
}

export class ShiftDialog extends PlannerModal {
  constructor(app: App, private count: number, private accept: (delta: number, durations: ShiftDurations) => Promise<void>) { super(app); }
  onOpen(): void {
    this.titleEl.setText(uiText(this.count > 1 ? `Shift ${this.count} selected` : 'Shift plan'));
    this.contentEl.createEl('p', { text: 'Move unchecked plans by whole minutes: positive is later, negative earlier. Completed rows never move.' });
    // The planner's own message replaces the browser's step-validation bubble.
    const form = this.contentEl.createEl('form', { cls: 'planner-plan-form', attr: { novalidate: '' } });
    const field = form.createEl('label', { cls: 'planner-field', text: 'Minutes' });
    const input = field.createEl('input', { type: 'number', value: '15', attr: { 'aria-label': 'Minutes to shift', step: '1' } });
    const choice = form.createEl('label', { cls: 'planner-field', text: 'Durations' });
    const durations = choice.createEl('select', { attr: { 'aria-label': 'Durations' } });
    for (const [value, text] of [['keep', 'Keep as written'], ['match', 'Match the new elapsed time'], ['elapsed', 'Keep credit; record the new elapsed time']])
      durations.createEl('option', { value, text });
    const hint = form.createEl('p', { cls: 'planner-input-hint' });
    const hints: Record<ShiftDurations, string> = {
      keep: 'Only end times change; minutes stay as written.',
      match: 'Each shifted plan, and the plan after it, gets minutes equal to its new elapsed time.',
      elapsed: 'Credit stays the same; the new elapsed time is recorded after it, such as 30/45.'
    };
    const describe = () => hint.setText(hints[durations.value as ShiftDurations]);
    durations.onchange = describe; describe();
    const error = form.createEl('p', { cls: 'planner-error', attr: { role: 'alert' } });
    const submit = dialogButtons(form, 'Shift', () => this.close());
    form.onsubmit = async event => {
      event.preventDefault();
      const value = Number(input.value);
      if (!input.value.trim() || !Number.isInteger(value)) { error.setText('Enter a whole number of minutes, such as 15 or -10.'); input.focus(); return; }
      submit.disabled = true; error.empty();
      try { await this.accept(value, durations.value as ShiftDurations); this.close(); }
      catch (e) { error.setText(message(e)); }
      finally { submit.disabled = false; }
    };
    input.focus(); input.select();
  }
}
export class CorrectDialog extends PlannerModal {
  constructor(app: App, private day: Day, private entries: Entry[], private accept: (change: Change) => Promise<void>) { super(app); }
  onOpen(): void {
    this.titleEl.setText(this.entries.length > 1 ? `Correct ${this.entries.length} selected` : 'Correct plan');
    this.contentEl.createEl('p', { text: 'Optional corrections for the selected activities, including completed ones. Review the changes before applying; unselected rows stay unchanged.' });
    const choices = correctionChoices(this.day, this.entries);
    const form = this.contentEl.createEl('form', { cls: 'planner-plan-form' });
    const field = form.createEl('label', { cls: 'planner-field', text: 'Correction' });
    const select = field.createEl('select', { attr: { 'aria-label': 'Correction' } });
    for (const option of choices) select.createEl('option', { value: option.value, text: option.label });
    select.value = 'times';
    const hint = form.createEl('p', { cls: 'planner-input-hint' });
    const anchor = form.createEl('p', { cls: 'planner-correction-anchor' });
    const preview = form.createDiv({ cls: 'planner-correction-preview', attr: { 'aria-live': 'polite' } });
    const error = form.createEl('p', { cls: 'planner-error', attr: { role: 'alert' } });
    const save = dialogButtons(form, 'Apply correction', () => this.close());
    const update = () => {
      const option = choices.find(option => option.value === select.value)!;
      hint.setText(option.description); anchor.empty(); preview.empty(); error.setText(option.error);
      save.disabled = !option.preview?.change.patches.length;
      if (!option.preview) return;
      anchor.setText(option.preview.anchors.map(a => `Start from ${a.time} - ${a.label}`).join(' | '));
      if (!option.preview.change.patches.length) preview.createEl('p', { text: 'Nothing to correct with this option.' });
      for (const patch of option.preview.change.patches) {
        const row = preview.createDiv({ cls: 'planner-correction-row' });
        row.createDiv({ text: '- ' + patch.before, cls: 'planner-diff-removed' });
        row.createDiv({ text: '+ ' + patch.after, cls: 'planner-diff-added' });
      }
    };
    select.onchange = update; update();
    form.onsubmit = async event => {
      event.preventDefault(); if (save.disabled) return;
      const option = choices.find(option => option.value === select.value)!;
      save.disabled = true; select.disabled = true; error.empty();
      try { await this.accept(option.preview!.change); this.close(); }
      catch (e) { error.setText(message(e)); }
      finally { save.disabled = false; select.disabled = false; }
    };
    select.focus();
  }
  onClose(): void { window.requestAnimationFrame(() => this.contentEl.ownerDocument.querySelector<HTMLElement>('.planner-row.is-current')?.focus({ preventScroll: true })); }
}
export class RoutineDialog extends PlannerModal {
  constructor(app: App, private controller: Controller, private date: string, private accept: (day: Day) => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText(uiText(`Create day | ${this.date}`));
    this.contentEl.createEl('p', { text: 'Choose a Markdown routine or start with a blank day. Routine notes stay unchanged.' });
    let routine = this.controller.settings.lastRoutine;
    const form = this.contentEl.createEl('form', { cls: 'planner-routine-form' });
    const field = form.createEl('label', { cls: 'planner-field' });
    field.createSpan({ text: 'Routine' });
    const select = field.createEl('select');
    select.createEl('option', { value: '', text: '📄 blank day' });
    const routines = this.controller.routines();
    for (const file of routines) select.createEl('option', { value: file.path, text: file.basename });
    if (routine && !routines.some(file => file.path === routine)) routine = '';
    select.value = routine; select.onchange = () => { routine = select.value; };
    const error = form.createEl('p', { cls: 'planner-error', attr: { role: 'alert' } });
    const submit = dialogButtons(form, 'Create day', () => this.close());
    form.onsubmit = async event => {
      event.preventDefault(); submit.disabled = true; error.empty();
      try { const day = await this.controller.create(this.date, routine); this.accept(day); this.close(); }
      catch (e) {
        if (!(e instanceof NameTaken)) { error.setText(message(e)); return; }
        // A note already uses this day's name: offer to turn it into the plan, never write without consent.
        new ChoiceDialog(this.app, `Add the plan to ${e.path}?`,
          `${e.path} already exists and is not a plan. Add the plan at the top of it? Everything already in the note stays below, unchanged. To keep it separate instead, rename that note first.`,
          'Add plan to this note', async () => {
            const day = await this.controller.create(this.date, routine, true);
            return () => { this.accept(day); this.close(); };
          }).focusAction().open();
      }
      finally { submit.disabled = false; }
    };
    this.submitOnEnter(() => form.requestSubmit());
    select.focus();
  }
}
export class ReplacePlanDialog extends PlannerModal {
  constructor(app: App, private controller: Controller, private date: string, private accept: () => void) { super(app); }
  onOpen(): void {
    this.titleEl.setText(uiText(`Replace plan | ${this.date}`));
    this.contentEl.createEl('p', { text: 'Use activities from a template in this daily note. Existing activities, including completed work, will be replaced and credited totals reset. Other text stays. You can Undo the replacement.' });
    const form = this.contentEl.createEl('form');
    const templates = this.controller.routines();
    let templatePath = templates.some(f => f.path === this.controller.settings.lastRoutine)
      ? this.controller.settings.lastRoutine : templates[0]?.path ?? '';
    let plan: Awaited<ReturnType<Controller['previewPlanReplacement']>> | undefined;
    let busy = false;
    const preview = form.createDiv({ cls: 'planner-template-preview', attr: { 'aria-live': 'polite' } });
    const error = form.createEl('p', { cls: 'planner-error', attr: { role: 'alert' } });
    let select!: HTMLSelectElement;
    new Setting(form).setName('Template').addDropdown(drop => {
      select = drop.selectEl; select.setAttribute('aria-label', 'Plan template');
      if (!templates.length) drop.addOption('', 'No templates available');
      for (const file of templates) drop.addOption(file.path, file.path);
      drop.setValue(templatePath).onChange(value => {
        templatePath = value; plan = undefined; preview.empty(); error.empty(); apply.disabled = true;
      });
    });
    // Keep controls before the preview so keyboard selection remains immediate.
    form.prepend(select.closest('.setting-item')!);
    const inspect = dialogButtons(form, 'Preview replacement', () => this.close(), { cls: '' });
    const apply = inspect.parentElement!.createEl('button', { text: 'Replace plan', cls: 'mod-warning', attr: { type: 'button' } }); apply.disabled = true;
    if (!templates.length) {
      inspect.disabled = true; select.disabled = true;
      error.setText('No plan templates found. Add a Markdown routine to the routines folder selected in Planner settings.');
    }
    const setBusy = (value: boolean) => { busy = value; select.disabled = value; inspect.disabled = value; apply.disabled = value || !plan; };
    form.onsubmit = async event => {
      event.preventDefault(); if (busy || !templatePath) return;
      plan = undefined; preview.empty(); error.empty(); setBusy(true);
      try {
        plan = await this.controller.previewPlanReplacement(this.date, templatePath);
        preview.createEl('p', { text: `${plan.removed} current activities (${plan.completed} completed) -> ${plan.added} unchecked template activities. This is the daily note after replacement:` });
        preview.createEl('pre', { text: applyPatches(plan.change.base, plan.change.patches), cls: 'planner-preview' });
      } catch (e) { error.setText(message(e)); }
      finally { setBusy(false); }
    };
    apply.onclick = async () => {
      if (busy || !plan) return;
      setBusy(true); error.empty();
      try { await this.controller.applyPlanReplacement(plan); this.accept(); this.close(); }
      catch (e) { plan = undefined; error.setText(message(e)); }
      finally { setBusy(false); }
    };
    select.focus();
  }
}
/** Quick-entry syntax for Help; shortcuts come from the same table the keys use. */
const ENTRY_SYNTAX: [string, string][] = [
  ['14:30 30 prj', 'Ended at 14:30 after 30 minutes; saved as 14:30 (30) : prj'],
  ['prj', 'The default block after the previous end time'], ['50 prj', 'Advance 50 minutes'],
  ['14:30 or 30', 'End time or duration alone uses the name activity'],
  ['Tab', 'Complete a matching configured activity name; otherwise move between controls'],
  ['1h30 prj', 'Hours and minutes (1h, 1h 30m, 90m), saved as minutes'],
  ['14:30 prj', 'End at 14:30; credit the elapsed minutes'], ['14:30 30/ prj', 'Credit 30; record the elapsed minutes'],
  ['70/60 prj', 'Credit more than the elapsed time, for example from a buffer'],
  ['14:30 30-0/ prj & lunch', 'Join activities with &, one amount each'],
  ['20-10 free time & prj (review)', 'Each part\'s first word names it; parentheses describe it and earn nothing'],
  ['14:30; 30; read 2 chapters', 'Semicolons separate time, minutes and activity'],
  ['14:30 .25/ prj', 'Credit 25% of the elapsed minutes'], ['.1/20 prj', 'Credit 10% of 20 minutes'],
  ['14:30 .5-.5/ pr1 & pr2', 'Shares round together and never exceed the elapsed block'],
  ['... or ?', 'A gap: nothing known'], ['? 30 prj', 'End time unknown: saved as ? (30) : prj'], ['12:55 >', 'Start again at 12:55'],
  ['Enter / Ctrl + Enter', 'Add the entry / start another line']
];
const HELP: { title: string; rows: [string, string][] }[] = [
  ...(['Move around', 'Selected activity'] as const).map(title => ({ title, rows: SHORTCUT_HELP.filter(s => s.section === title).map(s => [s.keys, s.description] as [string, string]) })),
  { title: 'Quick entry', rows: ENTRY_SYNTAX },
  { title: 'Undo', rows: SHORTCUT_HELP.filter(s => s.section === 'Undo').map(s => [s.keys, s.description] as [string, string]) }
];
export class HelpDialog extends PlannerModal {
  onOpen(): void {
    this.titleEl.setText(uiText('Planner help'));
    this.contentEl.addClass('planner-help');
    const streak = this.contentEl.createEl('section', { cls: 'planner-help-section' });
    streak.createEl('h3', { text: 'Hot-day streak' });
    streak.createEl('p', { text: '🔥 6d | best 21d shows the current run and longest recorded run. Yesterday stays active while today is below target. Uses credited totals and the hot range in thejaz-criteria.md (default >=300m), across all history. Missing or unknown dates break confirmed runs.' });
    for (const section of HELP) {
      const group = this.contentEl.createEl('section', { cls: 'planner-help-section' });
      group.createEl('h3', { text: section.title });
      const list = group.createEl('dl', { cls: 'planner-shortcuts' });
      for (const [keys, meaning] of section.rows) {
        const term = list.createEl('dt');
        // Alternatives are separate keys; separators stay plain text.
        for (const [index, part] of keys.split(/(, | or | \/ )/).entries())
          if (index % 2) term.appendText(part); else term.createEl('kbd', { text: part });
        list.createEl('dd', { text: meaning });
      }
    }
    this.contentEl.createEl('p', { cls: 'planner-input-hint',
      text: 'Row buttons show their single-key shortcuts. A/E/D/K/J use the current activity; S/R/X use selected activities. Disabled actions stay unavailable. Row-action letters work in Activity while you are not typing; menus keep their own keys. C still sets day context. Every action is also in the command palette for global hotkeys.' });
  }
}
export class ContextDialog extends PlannerModal {
  private returnFocus?: HTMLElement;
  constructor(app: App, private snapshot: ContextSnapshot,
    private accept: (context: string) => Promise<void>) { super(app); }
  onOpen(): void {
    this.returnFocus = this.contentEl.ownerDocument.activeElement as HTMLElement;
    this.contentEl.addClass('planner-context-dialog');
    const { date, minutes, summary, criteria, current, source } = this.snapshot;
    this.titleEl.setText(uiText(`Day context | ${date}`));
    this.contentEl.createEl('p', { text: `${minutes}m recorded. Choose how to classify this day.` });
    this.contentEl.createEl('p', { cls: 'planner-context-source', text: `Summary: ${summary.path}` });
    if (source !== summary.path) this.contentEl.createEl('p', { cls: 'planner-context-source', text: `Criteria: ${source}` });
    let value = current;
    if (current === 'multiple') this.contentEl.createEl('p', { cls: 'planner-input-hint', text: 'Multiple contexts are saved. This picker replaces them with one selection; Cancel keeps them.' });
    const group = this.contentEl.createDiv({ cls: 'planner-context-choices', attr: { role: 'radiogroup', 'aria-label': 'Day context' } });
    const options = [{ id: 'ordinary', title: '🌞 ordinary day', detail: 'Use productivity and weekend rules without a special context.' },
      ...contextOptions(criteria).map(option => {
        const name = option.label.toLowerCase() === option.context!.toLowerCase() ? option.label : `${option.context} - ${option.label}`;
        const targets = [...new Set(criteria.combinations.filter(r => r.kind === 'replaces' && r.markers.includes(option.key)).flatMap(r => r.targets))];
        const detail = !criteria.combinations.length ? 'No combination restrictions defined.' : targets.length ? `Replaces ${targets.join(', ')} when applicable.` : 'No replacement rule for this marker.';
        return { id: option.context!, title: uiText(`${option.symbol} ${name}`), detail: `${markerRange(option)} | ${detail}` };
      })];
    const inputs: HTMLInputElement[] = [];
    const name = `planner-context-${Date.now()}`;
    for (const option of options) {
      const row = group.createEl('label', { cls: 'planner-context-choice' });
      const input = row.createEl('input', { type: 'radio', attr: { name, value: option.id, 'aria-label': option.title, 'data-context': option.id } });
      input.checked = option.id === value; inputs.push(input);
      const copy = row.createSpan(); copy.createEl('strong', { text: option.title });
      copy.createSpan({ cls: 'planner-context-detail', text: option.detail });
      input.onchange = () => { value = option.id; update(); };
    }
    const policy = this.contentEl.createEl('details', { cls: 'planner-context-policy' });
    policy.createEl('summary', { text: `combination rules (${criteria.combinations.length})` });
    if (!criteria.combinations.length) policy.createEl('p', { cls: 'planner-input-hint', text: 'No combination restrictions are defined. Saved combinations are allowed; minute ranges still apply. This picker replaces contexts with one choice.' });
    else for (const rule of criteria.combinations) policy.createEl('p', { cls: 'planner-input-hint', text: rule.kind === 'exclusive' ? `${rule.label ? rule.label + ": " : ""}at most one of ${rule.markers.join(', ')}.` : `${rule.markers.join(', ')} replaces ${rule.targets.join(', ')}.` });
    const preview = this.contentEl.createDiv({ cls: 'planner-context-result', attr: { 'aria-live': 'polite' } });
    const error = this.contentEl.createDiv({ cls: 'planner-error', attr: { role: 'alert' } });
    const save = dialogButtons(this.contentEl, 'Save context', () => this.close(), { submit: false });
    const update = () => {
      preview.empty(); error.empty(); save.disabled = false;
      for (const input of inputs) input.parentElement!.classList.toggle('is-selected', input.checked);
      preview.createEl('strong', { text: 'Result for this day' });
      try {
        const result = contextResult(summary, date, value, criteria);
        preview.createEl('p', { text: uiText(`${minutes}m | ${result.symbols} ${result.labels.join(' + ')}`) });
        if (result.expires) preview.createEl('p', { cls: 'planner-input-hint', text: `${result.definition!.symbol} applies only at ${markerRange(result.definition!)}. At ${minutes}m, ordinary productivity applies. No special context will remain; reopening will show ordinary day.` });
        else preview.createEl('p', { cls: 'planner-input-hint', text: 'Saved only in this summary. Daily-note text stays unchanged.' });
      } catch (e) { save.disabled = true; error.setText(message(e)); }
    };
    update();
    window.requestAnimationFrame(() => { if (group.isConnected) (inputs.find(input => input.checked) ?? inputs[0])?.focus({ preventScroll: true }); });
    save.onclick = async () => {
      if (save.disabled) return;
      save.disabled = true; error.empty();
      try { await this.accept(value); this.close(); }
      catch (e) { error.setText(message(e)); }
      finally { save.disabled = false; }
    };
    this.submitOnEnter(() => save.click());
  }
  onClose(): void {
    const target = this.returnFocus;
    queueMicrotask(() => { if (target?.isConnected) target.focus({ preventScroll: true }); else this.contentEl.ownerDocument.querySelector<HTMLElement>('.planner')?.focus({ preventScroll: true }); });
  }
}
