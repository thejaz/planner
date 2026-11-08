import { ItemView, Scope, setIcon, WorkspaceLeaf } from 'obsidian';
import type { ViewStateResult } from 'obsidian';
import { activityGroup, dateAdd, dateFromPath, displayMinutes, orderedCodes } from '../core/model';
import type { Day, Entry } from '../core/model';
import type { EditPart } from '../core/changes';
import { EntryInputError, applyPatches, unknownEndTime, canMoveEntry, fixHeading, changeOf, refreshedEntryIndex, deleteEntries, compactActivity, compactDuration, compactEdit, editParts, entryFields, footerPatches, guardElapsedAnchor, insertRows, moveEntry, quickEntry, shiftEntries, toggleEntry } from '../core/changes';
import { calculate, disputed, effectiveTotals, parseDay } from '../core/reader';
import { rangeFor, review, reviewDescription, summaryPatches, summaryTotals } from '../core/history';
import { differenceLine, projectDifferences, WAITING } from '../core/summary-totals';
import type { Controller } from '../controller';
import { EMOJI_PATH, PROJECT_SOURCES_PATH, REGISTRY_PATH } from '../controller';
import { ChoiceDialog, ContextDialog, UnsavedActivityDialog, HelpDialog, ManageProjectDialog, ProjectDialog, ReplacePlanDialog, RoutineDialog, ShiftDialog, CorrectDialog } from './dialogs';
import { correctionChoices } from '../core/plan-correction';
import { interpretEntry } from '../core/interpret';
import { matchHelpers } from '../core/activity-helpers';
import { activityCompletion } from '../core/activity-completion';
import { activityTarget, replaceActivityComponent, scheduleNameRange } from '../core/activity-target';
import { isDraftReplacement, replaceDraft } from './draft-replacement';
import { EditDurationHistory, replacesDuration } from '../core/edit-duration-history';
import { openPlannerSettings } from './open-settings';
import { ROW_SHORTCUTS, shortcutFor } from './shortcuts';
import type { RowAction, ShortcutAction } from './shortcuts';
import { projectLabelParts } from '../core/projects';
import { PLUGIN_ICON, PLUGIN_NAME } from '../branding';
import { formatShare, groupTotals, markerCounts, parseMarkerCriteria, workShareTotal } from '../core/review-extras';
import { message, uiText } from './text';
import { openChoiceMenu } from './choice-menu';
import type { ChoiceOption } from './choice-menu';
import { isChange, isSummaryCheckpoint } from '../storage/journal';
import { planDate } from '../core/syntax';
import { showRebuild, showRetry } from './settings-feedback';

export const VIEW_TYPE = 'thejaz-planner';
const NEW_ACTIVITY = 'First time this activity appears in your notes.';
export class PlannerView extends ItemView {
  date: string;
  mode: 'day' | 'review' = 'day';
  day: Day | null = null;
  selected = -1;
  selection = new Set<number>();
  private selectionAnchor: number | null = null;
  private draft = '';
  private captureOpen = false;
  private draftSelection: [number, number] | undefined;
  private captureId = `planner-entry-${Math.random().toString(36).slice(2)}`;
  private labelSequence = 0;
  private moving = false;
  private submitting = false;
  /** A date field holding typed, uncommitted text; background redraws wait so it is not reset. */
  private dateTyping: HTMLInputElement | undefined;
  private refreshDeferred = false;
  /** Restores a date field's shown date; Escape leaves the field, which must not apply typed text. */
  private dateCancels = new WeakMap<HTMLElement, () => void>();
  private activityEditor: { element: HTMLElement; input: HTMLTextAreaElement; dirty: () => boolean; save: () => Promise<boolean>; cancel: () => Promise<void> } | undefined;
  private leavingEditor = false;
  private openingEditor = false;
  private entryMode: 'log' | 'plan' = 'plan';
  private captureOptionRefresh: (() => void)[] = [];
  private captureMenu: { hide: () => void } | undefined;
  private section = 'morning';
  private preset = 'period';
  private rangeStart = '';
  private rangeEnd = '';
  private project = '';
  private page = 0;
  private recordsOpen = false;
  private unsubscribe: (() => void) | undefined;
  private generation = 0;
  private previews: HTMLElement | undefined;
  private suggestions: HTMLElement | undefined;
  private captureSuggestionsRefresh: (() => void) | undefined;
  private entryAnchor: HTMLElement | undefined;
  private selectionDate = '';
  private main: HTMLElement | undefined;
  private refreshQueued = false;
  private streakStatus: HTMLElement | undefined;
  private scopePushed = false;
  private scrollPositions = { day: 0, review: 0 };
  private plannerScope: Scope;
  /** Key events already seen through the scope, so the DOM fallback never handles one twice. */
  private handledKeys = new WeakSet<KeyboardEvent>();
  private contextOpening = false;
  private correctionCache?: { day: Day; key: string; choices: ReturnType<typeof correctionChoices> };
  constructor(leaf: WorkspaceLeaf, readonly controller: Controller) {
    super(leaf); this.date = controller.now().date;
    // Own a focus-scoped keymap separately from View.scope: Obsidian manages
    // View.scope itself, so manually pushing that same scope can double-link it.
    this.plannerScope = new Scope(this.app.scope);
    this.plannerScope.register(null, null, event => {
      if (!this.contentEl.contains(event.target as Node)) return;
      // The DOM listener may already have handled this event; never handle it twice.
      if (!this.handledKeys.has(event)) { this.handledKeys.add(event); this.keyboard(event); }
      if (event.defaultPrevented) return false;
    });
  }
  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return PLUGIN_NAME; }
  getIcon(): string { return PLUGIN_ICON; }
  getState(): Record<string, unknown> { return { date: this.date, mode: this.mode, selected: this.selected, scroll: this.contentEl.scrollTop, recordsOpen: this.recordsOpen }; }
  async setState(state: Record<string, unknown>, result: ViewStateResult): Promise<void> {
    if (this.activityEditor) { await this.leaveActivityEditor(() => this.setState(state, result)); return; }
    if (typeof state.recordsOpen === 'boolean') this.recordsOpen = state.recordsOpen;
    if (typeof state.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(state.date)) this.date = state.date;
    if (state.mode === 'day' || state.mode === 'review') this.mode = state.mode;
    if (typeof state.selected === 'number') this.selected = state.selected;
    await this.refresh();
    if (typeof state.scroll === 'number') this.contentEl.scrollTop = state.scroll;
    await super.setState(state, result);
  }
  async onOpen(): Promise<void> {
    this.contentEl.addClass('planner');
    // A focusable view root: clicking empty space keeps focus (and shortcuts) in the planner.
    this.contentEl.tabIndex = -1;
    // Obsidian's scope stack can stop routing keys here (for example after the focused
    // editor is removed). Keys inside the planner always arrive here as well; each
    // event is handled once, by whichever path sees it first.
    this.registerDomEvent(this.contentEl, 'keydown', event => {
      if (event.defaultPrevented || this.handledKeys.has(event)) return;
      this.handledKeys.add(event); this.keyboard(event);
    });
    this.registerDomEvent(this.contentEl, 'focusin', () => {
      if (!this.scopePushed) { this.app.keymap.pushScope(this.plannerScope); this.scopePushed = true; }
    });
    this.registerDomEvent(this.contentEl, 'focusout', () => {
      this.contentEl.ownerDocument.defaultView!.setTimeout(() => {
        if (this.contentEl.isConnected && this.refreshDeferred && !this.dateTyping && !this.activityEditor && !(this.captureOpen && this.contentEl.ownerDocument.activeElement?.closest('.planner-capture'))) {
          this.refreshDeferred = false; void this.refresh();
        }
      }, 150);
      queueMicrotask(() => {
        if (!this.contentEl.contains(this.contentEl.ownerDocument.activeElement) && this.scopePushed) {
          this.app.keymap.popScope(this.plannerScope); this.scopePushed = false;
        }
      });
    });
    this.unsubscribe = this.controller.onChange(projectChange => {
      if (projectChange && this.project === projectChange.from) this.project = projectChange.to;
      if (this.refreshQueued) return;
      this.refreshQueued = true;
      queueMicrotask(() => { this.refreshQueued = false; void this.refresh(); });
    });
    // Clock checks repaint only the badge: an active draft keeps its caret and text.
    const checkClock = () => this.updateStreak();
    const ownerWindow = this.contentEl.ownerDocument.defaultView!;
    const clock = ownerWindow.setInterval(checkClock, 15000);
    this.register(() => ownerWindow.clearInterval(clock));
    this.registerDomEvent(ownerWindow, 'focus', checkClock);
    this.registerDomEvent(this.contentEl.ownerDocument, 'visibilitychange', checkClock);
    await this.refresh();
  }
  async onClose(): Promise<void> {
    this.captureMenu?.hide();
    this.unsubscribe?.(); this.generation++;
    if (this.scopePushed) this.app.keymap.popScope(this.plannerScope);
    this.scopePushed = false;
  }
  /**
   * A date field that applies a picked date at once but typed text only on Enter or
   * leaving the field. The browser reports each typed digit as a new date (2 -> year
   * 0002), so applying those would jump and redraw under the caret. Escape restores.
   */
  private dateField(parent: HTMLElement, value: string, label: string, commit: (date: string) => unknown): HTMLInputElement {
    // Notes are named with four-digit years; the picker offers only those.
    const input = parent.createEl('input', { type: 'date', value, attr: { 'aria-label': label, min: '1000-01-01', max: '9999-12-31' } });
    let typed = false;
    const settle = () => {
      typed = false;
      if (this.dateTyping === input) this.dateTyping = undefined;
      if (this.refreshDeferred) { this.refreshDeferred = false; void this.refresh(); }
    };
    const apply = () => {
      const date = input.value, valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && input.checkValidity();
      settle();
      if (!valid) { input.value = value; return; }
      if (date !== value) void Promise.resolve(commit(date)).catch(error => this.controller.report(error));
    };
    const cancel = () => { input.value = value; settle(); };
    this.dateCancels.set(input, cancel);
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); apply(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
      else if (event.key !== 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) { typed = true; this.dateTyping = input; }
    });
    // A picked date arrives without typing; typed text waits for Enter or blur.
    input.addEventListener('change', () => { if (!typed) apply(); });
    input.addEventListener('blur', () => { if (typed) apply(); });
    return input;
  }
  private updateStreak(): void {
    const host = this.streakStatus;
    if (!host?.isConnected) return;
    const streak = this.controller.streak(), key = JSON.stringify(streak);
    if (host.dataset.state === key) return;
    host.dataset.state = key; host.empty();
    if (streak.available) {
      host.createSpan({ text: `${streak.symbol} ${streak.current}d`, cls: 'planner-streak-current' });
      host.createSpan({ text: '|', cls: 'planner-streak-divider', attr: { 'aria-hidden': 'true' } });
      host.createSpan({ text: `best ${streak.best}d`, cls: 'planner-streak-best' });
      host.createSpan({ text: ' Hot-day streak, through today or yesterday. Best across all recorded history.', cls: 'planner-sr-only' });
    } else if (!this.controller.indexed || this.controller.indexing) {
      host.setText('🔥 ... | best ...');
      host.createSpan({ text: ' Loading planner history.', cls: 'planner-sr-only' });
    } else {
      const button = this.button(host, '🔥 unavailable', () => {
        const path = this.controller.criteriaPath();
        new ChoiceDialog(this.app, 'Hot-day streak unavailable', streak.reason,
          'Open criteria', async () => { if (path) await this.controller.openSource(path); }, '', !!path).open();
      }, 'planner-streak-unavailable');
      this.accessibleName(button, 'Hot-day streak unavailable. Show explanation');
    }
  }
  async refresh(): Promise<void> {
    this.updateStreak();
    // Keep the draft, caret and original write snapshot intact during indexing.
    // The normal guarded mutation path checks any concurrent source edits.
    if (this.activityEditor) return;
    if (this.dateTyping) { this.refreshDeferred = true; return; }
    const draftFocus = this.contentEl.ownerDocument.activeElement?.closest('.planner-capture');
    if (!this.submitting && this.mode === 'day' && this.day?.date === this.date && this.captureOpen && draftFocus) { this.refreshDeferred = true; return; }
    const revision = ++this.generation, started = performance.now();
    try {
      const day = await this.controller.getDay(this.date);
      if (revision !== this.generation || this.activityEditor) return;
      // Focus can enter the composer while the asynchronous read is in flight.
      if (!this.submitting && this.mode === 'day' && this.day?.date === this.date && this.captureOpen && this.contentEl.ownerDocument.activeElement?.closest('.planner-capture')) { this.refreshDeferred = true; return; }
      // Capture at paint time, not before the asynchronous read: a user may
      // have moved focus while that read was in flight.
      const active = this.contentEl.ownerDocument.activeElement as HTMLInputElement | null;
      const focus = active && this.contentEl.contains(active) ? {
        key: active.dataset.plannerKey, start: active.selectionStart, end: active.selectionEnd
      } : null;
      const scroll = this.contentEl.scrollTop;
      if (this.day && day && (this.day.path !== day.path || this.day.entries.length !== day.entries.length ||
        day.entries.some((entry, index) => entry.raw !== this.day!.entries[index]?.raw))) {
        // Index-based ranges must never drift onto different activities after
        // a manual edit, insertion, move or deletion in the source.
        this.selected = Math.min(this.selected, day.entries.length - 1);
        this.clearRowSelection();
      }
      if (this.selected < 0 && day && this.selectionDate !== this.date) this.selected = day.entries.map(e => e.checked).lastIndexOf(true);
      if (day) this.selectionDate = this.date;
      this.day = day; this.draw();
      this.contentEl.scrollTop = scroll;
      if (focus?.key) {
        const target = [...this.contentEl.querySelectorAll<HTMLElement>('[data-planner-key]')].find(el => el.dataset.plannerKey === focus.key);
        target?.focus({ preventScroll: true });
        if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
          if (focus.start !== null && focus.end !== null && target.type !== 'date') target.setSelectionRange(focus.start, focus.end);
        }
      }
      this.controller.performance.warmOpens.push(performance.now() - started);
    } catch (error) {
      if (revision !== this.generation || this.activityEditor) return;
      this.contentEl.empty();
      this.contentEl.createEl('p', { text: message(error), cls: 'planner-error' });
      this.button(this.contentEl, 'Open review', () => { this.mode = 'review'; this.draw(); });
    }
  }
  private button(parent: HTMLElement, text: string, action: () => unknown, cls = '', key?: string): HTMLButtonElement {
    const button = parent.createEl('button', { text: uiText(text), cls, attr: { type: 'button' } });
    if (key) button.dataset.plannerKey = key;
    button.addEventListener('click', () => {
      try { Promise.resolve(this.activityEditor && !this.activityEditor.element.contains(button)
        ? this.leaveActivityEditor(action) : action()).catch(error => this.controller.report(error)); }
      catch (error) { this.controller.report(error); }
    }); return button;
  }
  private accessibleName(element: HTMLElement, text: string): void {
    const id = element.getAttribute('aria-labelledby') ?? `${this.captureId}-label-${this.labelSequence++}`;
    let label = this.contentEl.querySelector<HTMLElement>(`#${id}`);
    if (!label) label = this.contentEl.createSpan({ cls: 'planner-sr-only', attr: { id } });
    label.setText(text); element.setAttribute('aria-labelledby', id); element.removeAttribute('aria-label');
  }
  private colorProject(element: HTMLElement, code: string): void {
    const palette = [260, 210, 160, 325, 30, 185, 285, 140, 15];
    const known = this.controller.settings.projectCodes.indexOf(code.toUpperCase());
    const index = known < 0 ? [...code].reduce((sum, c) => sum + c.charCodeAt(0), 0) : known;
    element.style.setProperty('--planner-project-hue', String(palette[index % palette.length]));
  }
  private share(parent: HTMLElement, value: number, total: number | null, basis: string): void {
    const text = formatShare(value, total);
    const share = parent.createEl('small', { text: text === '—' ? text : `(${text})`, cls: 'planner-share', attr: { 'aria-label': text === '—' ? 'Percentage unavailable: no reliable total.' : `${text} of ${basis}` } });
    if (text === '—') share.title = 'No reliable total for this percentage.';
  }
  private projectChip(parent: HTMLElement, code: string, minutes: number, total?: number | null, rank?: number): void {
    const chip = parent.createEl('button', { cls: `planner-project-chip${minutes ? '' : ' is-zero'}`, attr: { type: 'button' } });
    chip.onclick = () => this.manageProject(code);
    this.colorProject(chip, code);
    if (rank !== undefined) chip.createSpan({ text: `${rank}.`, cls: 'planner-project-rank', attr: { 'aria-label': `Rank ${rank}` } });
    const emoji = this.controller.settings.projectEmojis[code];
    if (emoji || rank !== undefined) chip.createSpan({ text: emoji ?? '', cls: 'planner-project-emoji' });
    chip.createEl('strong', { text: code });
    chip.createSpan({ text: displayMinutes(minutes), cls: 'planner-project-minutes' });
    if (total !== undefined) this.share(chip, minutes, total, 'selected work');
  }
  manageProject(code = this.controller.projectCodes()[0] ?? ''): void {
    if (this.whenEditorClosed(() => this.manageProject(code))) return;
    new ManageProjectDialog(this.app, this.controller, code).open();
  }
  private addProjectChip(parent: HTMLElement): void {
    this.button(parent, '+ Add new project', () => this.addProject(), 'planner-project-add');
  }
  addProject(): void {
    if (this.whenEditorClosed(() => this.addProject())) return;
    const dayPath = this.mode === 'day' ? this.day?.path : undefined;
    new ProjectDialog(this.app, (code, emoji) => this.controller.createProject(code, emoji, dayPath)).open();
  }
  private activityLabel(parent: HTMLElement, entry: Entry): void {
    const label = parent.createSpan({ cls: 'planner-label' });
    const units = activityGroup(entry.label).units, first = (name: string) => !!name && this.controller.isFirstActivity(name);
    let at = 0;
    for (const part of projectLabelParts(entry, this.controller.codesFor(this.day)).parts) {
      const start = at; at += part.text.length;
      if (part.known && part.code) {
        const strong = label.createEl('strong', { text: part.text.toLowerCase(), cls: 'planner-project-name' });
        this.colorProject(strong, part.code);
      } else if (part.code) label.createSpan({ text: part.text, cls: first(part.text) ? 'planner-unknown-project planner-new-activity' : 'planner-unknown-project', attr: first(part.text) ? { title: NEW_ACTIVITY } : {} });
      else {
        // Names never indexed before this entry are green until another occurrence is indexed.
        let from = start;
        for (const unit of units.filter(u => u.nameStart >= start && u.nameEnd <= at && first(u.name))) {
          label.appendText(entry.label.slice(from, unit.nameStart));
          label.createSpan({ text: unit.name, cls: 'planner-new-activity', attr: { title: NEW_ACTIVITY } });
          from = unit.nameEnd;
        }
        label.appendText(entry.label.slice(from, at));
      }
    }
  }
  private unallocatedText(minutes: number): string {
    return minutes < 0 ? `${Math.abs(minutes)}m above recorded total` : `${minutes}m unallocated`;
  }
  private draw(): void {
    if (this.activityEditor) return;
    this.captureMenu?.hide();
    const active = this.contentEl.ownerDocument.activeElement as HTMLElement | null;
    const focused = !!active && this.contentEl.contains(active) ? active.dataset.plannerKey ?? '' : null;
    const expanded = new Set([...this.contentEl.querySelectorAll<HTMLDetailsElement>('details[open]')]
      .map(el => el.querySelector('summary')?.textContent));
    this.contentEl.empty();
    const shell = this.contentEl.createDiv({ cls: 'planner-shell' });
    const header = shell.createEl('header', { cls: 'planner-header' });
    // One Activity/Report toggle; V switches it from anywhere in the planner.
    const start = header.createDiv({ cls: 'planner-header-start' });
    const views = start.createDiv({ cls: 'planner-tabs planner-view-toggle', attr: { role: 'group', 'aria-label': 'Planner view' } });
    for (const mode of ['day', 'review'] as const) {
      const option = this.button(views, mode === 'day' ? 'Activity' : 'Report', () => this.switchMode(mode),
        `planner-view-option${this.mode === mode ? ' is-active' : ''}`, `tab-${mode}`);
      option.setAttribute('aria-pressed', String(this.mode === mode));
    }
    this.streakStatus = start.createDiv({ cls: 'planner-streak', attr: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' } });
    this.updateStreak();
    const iconButton = (parent: HTMLElement, label: string, icon: string, action: () => unknown, cls: string) => {
      const button = this.button(parent, '', action, `planner-icon ${cls}`);
      button.setAttribute('aria-label', label);
      const glyph = button.createSpan({ attr: { 'aria-hidden': 'true' } }); setIcon(glyph, icon);
    };
    if (this.mode === 'day') {
      const navigation = header.createDiv({ cls: 'planner-date-navigation' });
      iconButton(navigation, 'Previous day', 'chevron-left', () => this.navigate(dateAdd(this.date, -1)), 'previous');
      this.dateField(navigation, this.date, 'Planning date', date => this.navigate(date)).dataset.plannerKey = 'date';
      iconButton(navigation, 'Next day', 'chevron-right', () => this.navigate(dateAdd(this.date, 1)), 'next');
      this.button(navigation, 'Today', () => this.navigate(this.controller.now().date), 'planner-text-button');
    }
    iconButton(header, 'Keyboard help', 'circle-help', () => new HelpDialog(this.app).open(), 'help');
    this.main = shell.createEl('main');
    this.main.toggleClass('planner-day-main', this.mode === 'day');
    this.main.toggleClass('planner-review-main', this.mode === 'review');
    if (this.mode === 'day') this.drawDay(this.main); else this.drawReview(this.main);
    if (this.controller.issues.size) {
      const details = shell.createEl('details', { cls: 'planner-notices' });
      const count = this.controller.issues.size;
      details.createEl('summary', { text: `${count} ${count === 1 ? 'thing needs' : 'things need'} attention` });
      // Offer only the actions that can help now; a disabled button only raises the question why.
      const action = (parent: HTMLElement, label: string, fn: () => unknown, enabled: boolean, hint: string) => {
        if (!enabled) return;
        const button = this.button(parent, label, fn);
        button.title = hint;
        button.setAttribute('aria-description', hint);
      };
      const operations = this.controller.journal.data.operations;
      const summary = this.controller.summaries.get(this.controller.settings.summaryPath);
      const affected = new Map<string, Day>();
      for (const [path, issue] of this.controller.issues) {
        const item = details.createDiv({ cls: 'planner-attention-item' });
        const day = this.controller.days.get(path);
        item.createEl('p', { text: `${day?.date ? day.date + ': ' : ''}${issue}` });
        if (day) affected.set(path, day);
        if (path === 'summary') for (const d of this.controller.days.values()) {
          if (d.date && issue.includes(d.date + ':')) affected.set(d.path, d);
        }
        // Each problem carries the button that fixes it.
        const fixes = item.createDiv({ cls: 'planner-actions' });
        if (path === 'recovery' || path === 'projects')
          action(fixes, 'Finish interrupted edits', () => this.recovery(), operations.some(o => o.state === 'interrupted' || o.state === 'pending'),
            'See which edits stopped partway and finish them. Nothing is written if a note changed since.');
        if (path === 'summary' || path.startsWith('summary-period:')) {
          action(fixes, 'Review summary', () => this.summaryPreview(), this.controller.indexed && !!summary?.start && !!summary.end,
            'Compare the summary with your daily notes before changing anything.');
          action(fixes, 'Open summary note', () => this.controller.openSource(this.controller.settings.summaryPath), !!summary,
            'Open the summary note to fix its Days line or duplicate rows.');
        }
        if (path.startsWith(WAITING)) {
          const source = path.slice(WAITING.length), target = this.controller.summaries.get(source);
          action(fixes, 'Review summary', () => this.summaryPreview(source), this.controller.indexed && !!target?.start && !!target.end,
            'Compare this summary with your daily notes before changing anything.');
          action(fixes, 'Open summary note', () => this.controller.openSource(source), !!target, 'Open this summary note.');
        }
        if (path === 'index') action(fixes, 'Rebuild index', () => showRebuild(this.controller), !this.controller.indexing,
          'Read your notes again. This does not change them.');
        if (!fixes.childElementCount) fixes.remove();
      }
      for (const day of affected.values()) {
        const item = details.createDiv({ cls: 'planner-attention-item' });
        const name = day.date ?? day.path, calculated = calculate(day);
        item.createEl('p', { text: day.recordedOnly ? `${name}: some recorded totals in this note need fixing.`
          : `${name}: the note's total says ${day.recordedSum ?? '?'}m, but completed activities add up to ${calculated.sum}m${calculated.complete ? '' : ' (some activities are incomplete)'}.` });
        const actions = item.createDiv({ cls: 'planner-actions' });
        const canReconcile = !day.recordedOnly && !day.legacy && !day.diagnostics.some(d => d.blocks) && disputed(day) &&
          [...this.controller.days.values()].filter(d => d.date === day.date).length === 1;
        action(actions, `Compare totals | ${day.date}`, () => this.reconcile(day), canReconcile,
          'Compare the totals at the bottom of this note with its completed activities before replacing them.');
        action(actions, `Open note | ${day.date}`, () => this.controller.openSource(day.path), true, 'Open this daily note to check or fix its entries.');
      }
      const actions = details.createDiv({ cls: 'planner-actions' });
      action(actions, 'Check again', () => this.controller.recheckSummary(), this.controller.indexed,
        'Check your notes and summary again and clear anything already fixed. Does not change notes.');
      action(actions, 'Retry summary update', () => showRetry(this.controller), this.controller.indexed && operations.some(o => o.summaryPending && o.state === 'done'),
        'Update the summary for edits that were saved but not yet added to it, and say what is still waiting and why.');
      action(actions, 'Undo last change', () => this.controller.undo(), this.controller.journal.canUndo,
        'Undo the last planner change, if those notes have not been edited since.');
      if (!actions.childElementCount) actions.remove();
    }
    if (!this.controller.indexed) shell.createEl('p', { text: this.controller.indexing ? 'Indexing history in the background...' : 'History is not indexed yet.', cls: 'planner-muted' });
    for (const detail of this.contentEl.querySelectorAll<HTMLDetailsElement>('details'))
      if (expanded.has(detail.querySelector('summary')?.textContent)) detail.open = true;
    // Obsidian turns aria-label into a visual tooltip. Keep accessible names
    // through labelled text without repeating obvious UI labels on hover.
    for (const element of this.contentEl.querySelectorAll<HTMLElement>('[aria-label]'))
      this.accessibleName(element, element.getAttribute('aria-label')!);
    // Redrawing removes the focused control; return focus to its replacement or the view.
    if (focused !== null && !this.contentEl.contains(this.contentEl.ownerDocument.activeElement)) {
      const replacement = focused ? [...this.contentEl.querySelectorAll<HTMLElement>('[data-planner-key]')].find(el => el.dataset.plannerKey === focused) : undefined;
      (replacement ?? this.contentEl).focus({ preventScroll: true });
    }
  }
  toggleMode(): void { this.switchMode(this.mode === 'day' ? 'review' : 'day'); }
  /** Move keyboard focus to the selected (or first) activity, from anywhere. */
  focusActivities(): void {
    if (this.whenEditorClosed(() => this.focusActivities())) return;
    if (this.mode !== 'day') this.switchMode('day');
    if (!this.day?.entries.length) { this.focusCaptureInvitation(); return; }
    if (!this.day.entries[this.selected]) { this.selected = 0; this.clearRowSelection(); }
    this.paintSelection();
    this.contentEl.querySelector<HTMLElement>(`.planner-row[data-index="${this.selected}"]`)?.focus();
  }
  switchMode(mode: 'day' | 'review'): void {
    if (this.activityEditor) { void this.leaveActivityEditor(() => this.switchMode(mode)); return; }
    this.scrollPositions[this.mode] = this.contentEl.scrollTop;
    this.mode = mode; this.draw();
    this.contentEl.scrollTop = this.scrollPositions[mode];
  }
  async navigate(date: string): Promise<void> {
    if (this.activityEditor) { await this.leaveActivityEditor(() => this.navigate(date)); return; }
    this.date = date; this.selectionDate = ''; this.selected = -1; this.clearRowSelection(); this.page = 0; await this.refresh();
  }
  private drawDay(parent: HTMLElement): void {
    if (!this.day) {
      const empty = parent.createDiv({ cls: 'planner-empty' });
      empty.createEl('h2', { text: 'A clear start' });
      empty.createEl('p', { text: 'Choose a routine or begin with a minimal day.' });
      this.button(empty, 'Create day', () => this.newDay(), 'mod-cta');
      return;
    }
    const day = this.day, groups = new Map<string, Entry[]>();
    const title = day.lines.find(line => /^##\s+/.test(line.raw))?.raw.replace(/^##\s+/, '');
    parent.createEl('h2', { text: title ?? `plan for ${planDate(this.date)}`, cls: 'planner-day-title' });
    if (day.recordedOnly) {
      const totals = effectiveTotals(day);
      parent.createEl('p', { text: 'This note records totals only, without activity times. Edit the numbers in the note itself.', cls: 'planner-muted planner-recorded-description' });
      parent.createDiv({ cls: 'planner-total-line' }).createEl('strong', { text: `${totals.sum === null ? '?' : displayMinutes(totals.sum)} recorded${totals.complete ? '' : ' | incomplete'}` });
      const projects = parent.createDiv({ cls: 'planner-project-totals' });
      for (const code of Object.keys(totals.projects).sort((a, b) => totals.projects[b]! - totals.projects[a]!)) this.projectChip(projects, code, totals.projects[code]!);
      if (day.diagnostics.length) {
        const checks = parent.createDiv({ cls: 'planner-diagnostics' });
        for (const issue of day.diagnostics) checks.createEl('p', { text: `${issue.message} ${issue.action}` });
      }
      this.button(parent.createDiv({ cls: 'planner-actions' }), 'Open source', () => this.openSource());
      return;
    }
    this.drawQuickEntry(parent);
    for (const line of day.lines) {
      const match = /^###\s+(.+?)\s*$/.exec(line.raw);
      if (match) groups.set(match[1]!, []);
    }
    for (const entry of day.entries) {
      if (!groups.has(entry.section)) groups.set(entry.section, []);
      groups.get(entry.section)!.push(entry);
    }
    for (const [heading, entries] of groups) {
      const section = parent.createEl('section', { cls: 'planner-section', attr: { 'aria-label': heading } });
      section.dataset.plannerSection = heading;
      section.createEl('h3', { text: heading });
      if (!entries.length) section.createEl('p', { text: 'No activities yet', cls: 'planner-muted' });
      for (const entry of entries) this.drawRow(section, entry, day.entries.indexOf(entry));
      const add = this.button(section, 'Add activity', () => {
        this.selected = entries.length ? day.entries.indexOf(entries.at(-1)!) : -1;
        this.section = heading; this.clearRowSelection();
        this.paintSelection(); this.updatePreview(); this.focusEntry();
      }, 'planner-section-add');
      add.setAttribute('aria-label', `Add activity to ${heading}`);
    }
    this.placeCapture();
    const totals = calculate(day), effective = effectiveTotals(day), footer = parent.createEl('footer', { cls: 'planner-totals' });
    const totalLine = footer.createDiv({ cls: 'planner-total-line' });
    // A gap (...) is intentional time without an activity, not an unknown activity.
    const unknown = (entry: Entry) => entry.unknownCredit && entry.label !== '...';
    const unknownCompleted = day.entries.filter(entry => entry.checked && unknown(entry)).length;
    const unknownPlanned = day.entries.filter(entry => !entry.checked && unknown(entry)).length;
    const credit = effective.sum === null ? `${displayMinutes(totals.sum)} known credit`
      : `${displayMinutes(effective.sum)} ${unknownCompleted ? 'recorded' : 'credited'}`;
    totalLine.createEl('strong', { text: `${credit}${effective.complete ? '' : ' | incomplete'}${disputed(day) ? ' | recorded values' : ''}` });
    totalLine.createSpan({ text: `${displayMinutes(totals.plannedSum)} planned${unknownPlanned ? ` | ${unknownPlanned} unknown ${unknownPlanned === 1 ? 'activity' : 'activities'}` : ''}`, cls: 'planner-muted' });
    if (unknownCompleted) footer.createEl('p', { cls: 'planner-status', text: `${displayMinutes(totals.sum)} known completed credit | ${unknownCompleted} completed `
      + `${unknownCompleted === 1 ? 'activity has' : 'activities have'} unknown credit. Recorded totals are preserved.` });
    const visibleProjects = unknownCompleted ? totals.projects : effective.projects;
    const projectList = footer.createDiv({ cls: 'planner-project-totals', attr: { 'aria-label': unknownCompleted ? 'Known completed project credit' : 'Project totals' } });
    for (const code of Object.keys(visibleProjects).sort((a, b) => visibleProjects[b]! - visibleProjects[a]!)) this.projectChip(projectList, code, visibleProjects[code]!);
    this.addProjectChip(projectList);
    if (effective.unallocated) projectList.createSpan({ text: this.unallocatedText(effective.unallocated), cls: 'planner-status' });
    if (disputed(day)) footer.createEl('p', { text: `Completed entries calculate to ${displayMinutes(totals.sum)}${totals.complete ? '' : ' with unknown credit remaining'}. Recorded totals are preserved.`, cls: 'planner-muted' });
    const actions = footer.createDiv({ cls: 'planner-actions planner-day-action-section' });
    const history = actions.createDiv({ cls: 'planner-history-actions' });
    const action = (parent: HTMLElement, label: string, icon: string, run: () => unknown) => {
      const button = this.button(parent, label, run);
      const glyph = button.createSpan({ cls: 'planner-action-icon', attr: { 'aria-hidden': 'true' } });
      setIcon(glyph, icon); button.prepend(glyph); return button;
    };
    action(history, 'Undo', 'undo-2', () => this.controller.undo()).disabled = !this.controller.journal.canUndo;
    action(history, 'Redo', 'redo-2', () => this.controller.redo()).disabled = !this.controller.journal.canRedo;
    const tools = actions.createDiv({ cls: 'planner-day-tools' });
    action(tools, 'Open source', 'file-text', () => this.openSource());
    action(tools, 'Replace plan from template', 'file-input', () => this.replacePlan()).disabled = day.legacy;
    action(tools, 'Compact footer', 'list-filter', () => this.compact());
    action(tools, 'Set day context', 'sun', () => this.context());
    if (day.diagnostics.length) {
      const diagnostics = parent.createEl('details', { cls: 'planner-diagnostics' });
      diagnostics.createEl('summary', { text: `${day.diagnostics.length} note check${day.diagnostics.length === 1 ? '' : 's'}${disputed(day) ? ' | your numbers are kept' : ''}` });
      for (const item of day.diagnostics) {
        const row = diagnostics.createDiv();
        this.button(row, `Line ${item.line + 1}`, () => this.controller.openSource(day.path, item.line), 'planner-text-button');
        row.createSpan({ text: ` ${item.message} ${item.action}` });
        if (item.code === 'heading-date') this.button(row, 'Fix heading', () => this.controller.apply(fixHeading(day, item.line)), 'planner-text-button');
      }
      if (disputed(day) && !day.legacy) this.button(diagnostics, 'Compare totals', () => this.reconcile(), 'mod-cta');
    }
  }
  private drawQuickEntry(parent: HTMLElement): void {
    const form = parent.createEl('form', { cls: 'planner-capture' });
    const toggle = this.button(form, 'Add an activity...', () => {
      if (this.captureOpen) { this.setCaptureOpen(false); this.focusCaptureInvitation(); } else this.focusEntry();
    }, 'planner-capture-toggle', 'capture-toggle');
    toggle.setAttribute('aria-controls', this.captureId);
    const reveal = form.createDiv({ cls: 'planner-capture-reveal', attr: { id: this.captureId } });
    const body = reveal.createDiv({ cls: 'planner-capture-body' });
    const top = body.createDiv({ cls: 'planner-capture-options' });
    this.captureOptionRefresh = [];
    const choice = (name: string, key: string, options: ChoiceOption[], get: () => string, set: (value: string) => void) => {
      const open = () => {
        this.captureMenu?.hide();
        const generation = this.generation;
        const menu = openChoiceMenu(button, name, options, get(), value => { set(value); this.updatePreview(); },
          () => generation === this.generation, () => { if (this.captureMenu === menu) this.captureMenu = undefined; });
        this.captureMenu = menu;
      };
      const button = this.button(top, '', open, 'planner-capture-choice', `capture-${key}`);
      button.dataset.plannerChoice = key;
      button.setAttribute('aria-label', name); button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
      const icon = button.createSpan({ cls: 'planner-choice-icon', attr: { 'aria-hidden': 'true' } });
      const label = button.createSpan({ cls: 'planner-choice-label' });
      const chevron = button.createSpan({ cls: 'planner-choice-chevron', attr: { 'aria-hidden': 'true' } }); setIcon(chevron, 'chevron-down');
      const refresh = () => {
        const option = options.find(option => option.value === get()) ?? options[0]!;
        button.value = option.value; button.dataset.value = option.value; label.setText(option.label); setIcon(icon, option.icon);
        button.setAttribute('aria-description', option.label);
      };
      button.addEventListener('keydown', event => { if (event.key === 'ArrowDown') { event.preventDefault(); event.stopPropagation(); open(); } });
      this.captureOptionRefresh.push(refresh); refresh(); return button;
    };
    choice('Entry mode', 'mode', [{ value: 'plan', label: 'Plan an activity', icon: 'notebook-pen' }, { value: 'log', label: 'Log completed work', icon: 'check-check' }], () => this.entryMode, value => { this.entryMode = value as 'log' | 'plan'; });
    const section = choice('Section for new activity', 'section', [
      { value: 'morning', label: 'Morning', icon: 'sunrise' },
      { value: 'afternoon', label: 'Afternoon', icon: 'sun' },
      { value: 'evening', label: 'Evening', icon: 'moon' }
    ], () => this.section, value => {
      this.section = value; this.selected = -1; this.clearRowSelection(); this.paintSelection();
    });
    section.dataset.plannerSectionSelect = '';
    const help = body.createDiv({ cls: 'planner-entry-help' });
    help.createEl('strong', { text: 'End time | minutes | activity (time and minutes optional)' });
    help.createEl('p', { text: `Times are when an activity ended; the note keeps its minutes in parentheses, such as 14:30 (30) : prj. prj uses ${this.controller.settings.defaultBlockMinutes}m; 50 prj or 1h prj advances; 14:30 30/ prj records elapsed time; 30-0 prj & lunch joins activities; 14:30; 30; prj separates fields. ... leaves a gap; 14:30 > starts again. "now" uses ${this.controller.settings.timezone} time.` });
    this.entryAnchor = help.createEl('p', { cls: 'planner-entry-anchor', attr: { 'aria-live': 'polite' } });
    const textarea = body.createEl('textarea', { attr: { 'aria-label': 'Quick entry', rows: '1', placeholder: 'prj  |  50 prj  |  14:30 30/ prj  |  14:30; 30; prj  |  ...' } });
    textarea.dataset.plannerKey = 'quick-entry'; textarea.value = this.draft;
    textarea.rows = Math.min(8, Math.max(1, this.draft.split('\n').length));
    body.prepend(textarea);
    textarea.addEventListener('keydown', event => {
      if (this.completeActivity(event, textarea, () => { this.draft = textarea.value; this.updatePreview(); }, text => suggestionError.setText(text))) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); this.setCaptureOpen(false); this.focusCaptureInvitation();
      }
    });
    textarea.oninput = () => { this.draft = textarea.value; textarea.rows = Math.min(8, Math.max(1, this.draft.split('\n').length)); this.updatePreview(); };
    this.completionHint(textarea, body);
    this.suggestions = body.createDiv({ cls: 'planner-suggestions', attr: { 'aria-label': 'Activity suggestions' } });
    const suggestionError = body.createDiv({ cls: 'planner-error', attr: { role: 'alert' } });
    this.captureSuggestionsRefresh = this.bindActivitySuggestions(textarea, this.suggestions,
      () => { this.draft = textarea.value; suggestionError.empty(); this.updatePreview(); }, text => suggestionError.setText(text));
    this.previews = body.createDiv({ cls: 'planner-preview-area', attr: { 'aria-live': 'polite' } });
    const submit = body.createEl('button', { text: 'Add entry', type: 'submit', cls: 'planner-submit' });
    submit.setAttribute('title', 'Enter to add; Ctrl + Enter for a new activity line');
    form.onsubmit = e => { e.preventDefault(); void this.submit().catch(error => this.controller.report(error)); };
    this.updatePreview();
  }
  private previous(): Entry | undefined {
    if (!this.day) return undefined;
    if (this.selected >= 0) return this.day.entries[this.selected];
    const sectionStart = this.day.lines.findIndex(l => l.raw.toLowerCase() === `### ${this.section}`);
    return [...this.day.entries].reverse().find(e => e.line < sectionStart);
  }
  private entryOptions() {
    return { ...this.controller.settings, allowBaseline: !!this.day && !this.day.recordedOnly && this.day.entries.length === 0 };
  }
  private updatePreview(): void {
    if (!this.previews) return;
    this.setCaptureOpen(this.captureOpen);
    this.placeCapture();
    const previous = this.previous();
    this.entryAnchor?.setText(previous?.time ? `Calculate from ${previous.time} | ${previous.label}. Select another row to change the starting point.` : !this.day?.entries.length ? `A first end time without minutes saves n/a. Minutes alone, or / after the time, count from the configured start: ${this.controller.settings.defaultStartTime} ${this.controller.settings.defaultStartActivity}.` : 'No previous end time. Enter an endpoint such as 14:00 >, or write ? 30 buffer for an unknown endpoint.');
    this.captureSuggestionsRefresh?.();
    this.previews.empty();
    const submit = this.contentEl.querySelector<HTMLButtonElement>('.planner-submit');
    if (submit) submit.disabled = !this.draft.trim();
    if (!this.draft.trim()) return;
    const parsed = quickEntry(this.draft, this.entryMode, this.previous(), this.controller.now().time, this.controller.codesFor(this.day), this.entryOptions());
    this.previews.createEl('pre', { text: parsed.rows.join('\n'), cls: 'planner-preview' });
    const selected = this.day?.entries[this.selected];
    this.previews.createEl('p', { text: selected ? `Inserts after ${selected.time ?? '?'} | ${selected.label}` : `Inserts at the start of ${this.section}.`, cls: 'planner-muted' });
    for (const error of parsed.diagnostics) this.previews.createEl('p', { text: error, cls: 'planner-error' });
    for (const warning of parsed.warnings) this.previews.createEl('p', { text: warning, cls: 'planner-muted' });
    if (submit) submit.disabled = parsed.diagnostics.length > 0;
    for (const split of parsed.splits) {
      const button = this.button(this.previews, `Split equally${parsed.splits.length > 1 ? ` | line ${split.line}` : ''}: ${split.label}`, () => {
        this.draft = split.input;
        const input = this.contentEl.querySelector<HTMLTextAreaElement>('[data-planner-key="quick-entry"]');
        if (input) input.value = this.draft;
        this.updatePreview(); this.focusEntry();
      }, 'planner-split-choice');
      button.title = 'Fill an explicit allocation for review. Nothing is saved until you add the entry.';
    }
  }
  private placeCapture(): void {
    const form = this.contentEl.querySelector<HTMLElement>('.planner-capture');
    if (!form || !this.day) return;
    const selected = this.day.entries[this.selected];
    if (selected) {
      const row = this.contentEl.querySelector<HTMLElement>(`.planner-row[data-index="${this.selected}"]`);
      if (!row) return;
      this.section = selected.section;
      if (row.nextElementSibling !== form) row.after(form);
    } else {
      const section = [...this.contentEl.querySelectorAll<HTMLElement>('.planner-section')].find(el => el.dataset.plannerSection === this.section);
      const heading = section?.querySelector('h3');
      if (heading && heading.nextElementSibling !== form) heading.after(form);
    }
    for (const refresh of this.captureOptionRefresh) refresh();
    this.accessibleName(form, selected ? `Add activity after ${selected.time ?? '?'} ${selected.label}` : `Add activity at the start of ${this.section}`);
  }
  async submit(): Promise<void> {
    if (this.activityEditor) { await this.activityEditor.save(); return; }
    if (this.submitting) return;
    if (!this.captureOpen) { this.focusEntry(); return; }
    if (!this.day) return;
    this.submitting = true;
    try {
      const parsed = quickEntry(this.draft, this.entryMode, this.previous(), this.controller.now().time, this.controller.codesFor(this.day), this.entryOptions());
      if (parsed.diagnostics.length) throw new Error(parsed.diagnostics.join(' '));
      let change = insertRows(this.day, parsed.rows, this.day.entries[this.selected], this.section);
      if (parsed.calculated) change = guardElapsedAnchor(this.day, change, this.previous());
      const headingLine = this.day.lines.findIndex(l => l.raw.toLowerCase() === `### ${this.section}`);
      const insertionIndex = this.selected >= 0 ? this.selected + 1
        : this.day.entries.filter(e => e.line < headingLine).length;
      await this.controller.apply(change);
      this.draft = ''; this.draftSelection = undefined; this.captureOpen = false; this.selected = insertionIndex + parsed.rows.length - 1;
      this.clearRowSelection();
      await this.refresh();
      this.focusCaptureInvitation();
    } finally { this.submitting = false; }
  }
  private drawRow(parent: HTMLElement, entry: Entry, index: number): void {
    // Gaps and bare ? rows have nothing to show but a name; ? (30) : prj keeps its ? and minutes.
    const states = [entry.checked && 'is-complete', entry.time === null && !unknownEndTime(entry) && 'is-untimed',
      (this.selection.has(index) || index === this.selected) && 'is-selected', index === this.selected && 'is-current'].filter(Boolean);
    const row = parent.createDiv({ cls: ['planner-row', ...states].join(' '),
      attr: { tabindex: index === this.selected || (this.selected < 0 && index === 0) ? '0' : '-1', 'aria-label': `${entry.time ?? 'Unknown time'}, ${entry.label}, ${entry.checked ? 'completed' : 'planned'}` } });
    row.dataset.plannerKey = `row-${index}`; row.dataset.index = String(index);
    row.onfocus = () => {
      if (this.activityEditor) return;
      this.closeCaptureForSelection(index);
      if (this.selected !== index) { this.selected = index; this.clearRowSelection(); }
      if (this.selectionAnchor === null) this.selectionAnchor = index;
      this.paintSelection(); this.updatePreview();
    };
    row.addEventListener('mousedown', event => {
      if ((event.shiftKey || event.ctrlKey || event.metaKey) && !(event.target as Element).closest('button, input, select, textarea, a')) {
        // Keep the original focus/anchor until the range click is handled,
        // and avoid native browser text selection across activity rows.
        event.preventDefault();
      }
    });
    row.addEventListener('click', event => {
      if ((event.target as Element).closest('button, input, select, textarea, a')) return;
      if (this.activityEditor) { void this.leaveActivityEditor(() => this.selectActivity(index)); return; }
      this.closeCaptureForSelection(index);
      if (event.shiftKey) this.extendRowSelection(index);
      else if (event.ctrlKey || event.metaKey) {
        if (!this.selection.size && this.selected >= 0) this.selection.add(this.selected);
        if (this.selection.has(index)) this.selection.delete(index); else this.selection.add(index);
        this.selected = index; this.selectionAnchor = index;
      } else { this.selected = index; this.clearRowSelection(); this.selection.add(index); }
      this.paintSelection(); row.focus(); this.updatePreview();
    });
    const check = row.createEl('input', { type: 'checkbox', attr: { 'aria-label': `Mark ${entry.label} ${entry.checked ? 'planned' : 'completed'}` } });
    check.disabled = this.day!.legacy || entry.label === '...';
    check.checked = entry.checked; check.onchange = () => {
      if (this.activityEditor) { check.checked = entry.checked; void this.leaveActivityEditor(async () => { this.selected = index; await this.toggle(); }); return; }
      this.closeCaptureForSelection(index); this.selected = index; void this.toggle().catch(e => this.controller.report(e));
    };
    row.createSpan({ text: entry.time ?? '?', cls: 'planner-time' });
    const duration = row.createSpan({ cls: 'planner-duration' });
    for (const part of entry.duration.split(/(\/)/)) {
      if (part === '/' && /\d\s*\/\s*\d/.test(entry.duration)) duration.createEl('strong', { text: part, cls: 'planner-duration-divider' });
      else duration.appendText(part);
    }
    this.activityLabel(row, entry);
    for (const [selector, field] of [['.planner-time', 'time'], ['.planner-duration', 'minutes'], ['.planner-label', 'activity']] as const) {
      const cell = row.querySelector<HTMLElement>(selector)!;
      cell.title = 'Double-click to edit activity | F2';
      cell.addEventListener('dblclick', event => {
        if (event.shiftKey || event.ctrlKey || event.metaKey) return;
        event.preventDefault(); void this.startActivityEdit(index, field).catch(error => this.controller.report(error));
      });
    }
    const actions = row.createDiv({ cls: 'planner-row-actions' });
    const missing = projectLabelParts(entry, this.controller.codesFor(this.day)).unknown;
    if (missing.length) {
      actions.createSpan({ text: entry.unknownCredit
        ? `Not defined: ${missing.join(', ')}. Add as a project or edit the activity and its amounts.`
        : `Ordinary activities (not project credit): ${missing.join(', ')}. Add as a project if intended.`, cls: 'planner-project-warning' });
      for (const code of missing) this.button(actions, `Add ${code} as project`, () => this.controller.addProjectCode(code));
    }
    const add = this.button(actions, 'Add below', () => {
      this.selected = index; this.clearRowSelection();
      this.paintSelection(); this.updatePreview(); this.focusEntry();
    }, 'planner-add-below');
    const edit = this.button(actions, 'Edit', () => this.startActivityEdit(index));
    const count = this.selectedRows().length;
    const shift = this.button(actions, count > 1 ? `Shift ${count} selected` : 'Shift', () => {
      // Shift the multi-selection this row belongs to, or just this row.
      if (!this.selection.has(index)) { this.selected = index; this.clearRowSelection(); }
      return this.shift();
    });
    shift.disabled = this.day!.legacy || this.selectedRows().some(e => e.checked || e.clock === null);
    shift.title = 'Move this plan (or the selected plans) earlier or later.';
    shift.dataset.plannerShift = 'true';
    const correct = this.button(actions, count > 1 ? `Correct ${count} selected` : 'Correct', () => {
      if (!this.selection.has(index)) { this.selected = index; this.clearRowSelection(); }
      return this.correct();
    });
    correct.dataset.plannerCorrect = 'true';
    correct.disabled = !this.selectedCorrections().some(choice => choice.preview?.change.patches.length);
    const duplicate = this.button(actions, 'Duplicate', () => { this.selected = index; return this.duplicate(); });
    const up = this.button(actions, 'Move up', () => { this.selected = index; return this.move(-1); });
    const down = this.button(actions, 'Move down', () => { this.selected = index; return this.move(1); });
    up.dataset.plannerMove = 'up'; down.dataset.plannerMove = 'down';
    up.disabled = this.moving || this.day!.legacy || !canMoveEntry(this.day!, entry, -1);
    down.disabled = this.moving || this.day!.legacy || !canMoveEntry(this.day!, entry, 1);
    const remove = this.button(actions, this.selectedRows().length > 1 ? `Delete ${this.selectedRows().length} selected` : 'Delete', () => {
      this.selected = index; this.delete();
    });
    remove.dataset.plannerDelete = 'true';
    remove.disabled = this.day!.legacy;
    for (const [action, button] of Object.entries({ 'add-below': add, edit, shift, correct, duplicate, 'move-up': up, 'move-down': down, delete: remove }))
      button.dataset.plannerRowAction = action;
    this.labelRowShortcuts();
  }
  private labelRowShortcuts(): void {
    for (const button of this.contentEl.querySelectorAll<HTMLButtonElement>('[data-planner-row-action]')) {
      const key = ROW_SHORTCUTS[button.dataset.plannerRowAction as RowAction];
      button.setAttribute('aria-keyshortcuts', key);
      if (!button.querySelector('.planner-row-key')) button.createEl('kbd', { text: key.toUpperCase(), cls: 'planner-row-key', attr: { 'aria-hidden': 'true' } });
    }
  }
  private invokeRowShortcut(action: RowAction): void {
    const button = this.contentEl.querySelector<HTMLButtonElement>(`.planner-row.is-current [data-planner-row-action="${action}"]`);
    // Match a pointer click's focus as well as its handler, so refresh follows a moved activity.
    if (button && !button.disabled) { button.focus({ preventScroll: true }); button.click(); }
  }
  private clearRowSelection(): void {
    this.selection.clear(); this.selectionAnchor = this.selected >= 0 ? this.selected : null;
  }
  private extendRowSelection(index: number): void {
    if (!this.day?.entries.length) return;
    const anchor = this.selectionAnchor !== null && this.day.entries[this.selectionAnchor]
      ? this.selectionAnchor : this.selected >= 0 ? this.selected : index;
    this.selectionAnchor = anchor;
    this.selection = new Set(Array.from({ length: Math.abs(index - anchor) + 1 }, (_, n) => Math.min(index, anchor) + n));
    this.selected = index;
  }
  private selectedRows(): Entry[] {
    return [...new Set([...this.selection, this.selected])].sort((a, b) => a - b)
      .map(index => this.day?.entries[index]).filter((entry): entry is Entry => !!entry);
  }
  private selectedCorrections(): ReturnType<typeof correctionChoices> {
    if (!this.day) return [];
    const key = `${this.selected}|${[...this.selection].sort((a,b) => a-b).join(',')}`;
    if (!this.correctionCache || this.correctionCache.day !== this.day || this.correctionCache.key !== key)
      this.correctionCache = { day: this.day, key, choices: correctionChoices(this.day, this.selectedRows()) };
    return this.correctionCache.choices;
  }
  private paintSelection(): void {
    for (const row of this.contentEl.querySelectorAll<HTMLElement>('.planner-row')) {
      const index = Number(row.dataset.index);
      row.toggleClass('is-selected', index === this.selected || this.selection.has(index));
      row.toggleClass('is-current', index === this.selected);
      row.tabIndex = index === this.selected ? 0 : -1;
    }
    const count = this.selectedRows().length;
    for (const button of this.contentEl.querySelectorAll<HTMLButtonElement>('[data-planner-delete]'))
      button.setText(count > 1 ? `Delete ${count} selected` : 'Delete');
    const entries = this.selectedRows();
    for (const button of this.contentEl.querySelectorAll<HTMLButtonElement>('[data-planner-shift]')) {
      button.setText(count > 1 ? `Shift ${count} selected` : 'Shift');
      button.disabled = !this.day || this.day.legacy || !entries.length || entries.some(e => e.checked || e.clock === null);
    }
    const choices = this.selectedCorrections();
    const available = choices.some(choice => !!choice.preview?.change.patches.length);
    for (const button of this.contentEl.querySelectorAll<HTMLButtonElement>('[data-planner-correct]')) {
      button.setText(count > 1 ? `Correct ${count} selected` : 'Correct'); button.disabled = !available;
      button.title = available ? 'Preview optional time and duration corrections for the selected plans.' : choices.find(c => c.error)?.error ?? 'Nothing to correct; selected times and durations already agree.';
    }
    this.labelRowShortcuts();
  }
  private current(): Entry | undefined { return this.day?.entries[this.selected]; }
  private closeCaptureForSelection(index: number): void {
    if (index !== this.selected && this.captureOpen) this.setCaptureOpen(false);
  }
  private selectActivity(index: number): void {
    this.closeCaptureForSelection(index);
    this.selected = Math.min(index, (this.day?.entries.length ?? 0) - 1);
    this.clearRowSelection(); this.paintSelection(); this.updatePreview();
    this.contentEl.querySelector<HTMLElement>(`.planner-row[data-index="${this.selected}"]`)?.focus();
  }
  /** Resolve an open activity edit (Save/Discard/Stay) before an action; true when deferred. */
  private whenEditorClosed(action: () => unknown): boolean {
    if (!this.activityEditor) return false;
    void this.leaveActivityEditor(action).catch(error => this.controller.report(error));
    return true;
  }
  private async leaveActivityEditor(action: () => unknown): Promise<void> {
    const editor = this.activityEditor;
    if (!editor) { await action(); return; }
    if (this.leavingEditor) return;
    this.leavingEditor = true;
    try {
      const choice = editor.dirty() ? await new Promise<'save' | 'discard' | 'stay'>(resolve => new UnsavedActivityDialog(this.app, resolve).open()) : 'discard';
      if (choice === 'stay') {
        const date = this.contentEl.querySelector<HTMLInputElement>('[data-planner-key="date"]'); if (date) date.value = this.date;
        editor.input.focus(); return;
      }
      if (choice === 'save') { if (!await editor.save()) {
        const date = this.contentEl.querySelector<HTMLInputElement>('[data-planner-key="date"]'); if (date) date.value = this.date;
        editor.input.focus(); return;
      } }
      else await editor.cancel();
      await action();
    } finally { this.leavingEditor = false; }
  }
  private async startActivityEdit(index: number, field: EditPart = 'schedule', target?: { day: Day; entry: Entry }): Promise<void> {
    const original = target?.day ?? this.day, clicked = target?.entry ?? original?.entries[index];
    if (!original || !clicked) return;
    if (this.activityEditor) { await this.leaveActivityEditor(() => this.startActivityEdit(index, field, { day: original, entry: clicked })); return; }
    if (this.openingEditor) return;
    // Edit the note as it is now: let a just-finished action's writes land, then redraw.
    this.openingEditor = true;
    try { await this.controller.whenIdle(); await this.refresh(); } finally { this.openingEditor = false; }
    if (this.activityEditor) return;
    index = refreshedEntryIndex(original, clicked, this.day);
    const day = this.day!, entry = day.entries[index]!;
    if (day.legacy || entry.legacy) { await this.controller.openSource(day.path, entry.line); return; }
    const row = this.contentEl.querySelector<HTMLElement>(`.planner-row[data-index="${index}"]`);
    if (!row) return;
    this.captureMenu?.hide(); this.selected = index; this.clearRowSelection(); this.paintSelection();
    // Retain the add-composer draft/caret/settings without sharing edit state.
    const capture = this.contentEl.querySelector<HTMLElement>('.planner-capture');
    const addInput = capture?.querySelector<HTMLTextAreaElement>('textarea');
    if (addInput) this.draftSelection = [addInput.selectionStart, addInput.selectionEnd];
    if (capture) capture.hidden = true;
    row.hidden = true;
    const editor = row.parentElement!.createEl('form', { cls: 'planner-capture planner-activity-editor is-open' });
    row.after(editor);
    this.accessibleName(editor, 'Edit activity');
    const heading = editor.createDiv({ cls: 'planner-edit-heading' });
    heading.createSpan({ text: 'Editing activity', cls: 'planner-muted' });
    const close = this.button(heading, '', () => cancel(), 'planner-capture-toggle');
    this.accessibleName(close, 'Cancel editing activity'); setIcon(close.createSpan(), 'x');
    const body = editor.createDiv({ cls: 'planner-capture-body' });
    const input = body.createEl('textarea', { attr: { rows: '1', spellcheck: 'false' } });
    this.accessibleName(input, 'Edit activity input');
    const initial = compactActivity(entry); input.value = initial;
    this.completionHint(input, body);
    let durationTouched = false, replacementIntent = false, before = initial;
    const durationHistory = new EditDurationHistory(initial, entry.duration);
    input.addEventListener('beforeinput', event => {
      replacementIntent = false;
      if (isDraftReplacement(input) || ['historyUndo', 'historyRedo'].includes(event.inputType)) return;
      // Preserve same-text calculation requests, without treating separator edits as amount edits.
      replacementIntent = replacesDuration(input.value, input.selectionStart, input.selectionEnd, event.data);
    });
    const previous = day.entries[index - 1];
    body.createEl('p', { cls: 'planner-input-hint', text: unknownEndTime(entry) ? 'End time is unknown. Keep the written minutes, or enter a known endpoint to calculate elapsed time.' : previous?.time
      ? `The time is when this activity ended; it started at ${previous.time}. Blank, 0 or / credits the elapsed minutes; .25/ credits 25% of them.`
      : 'No previous end time. Enter an endpoint such as 14:00 > in Add below, or write ? 30 buffer for an unknown endpoint.' });
    const suggestions = body.createDiv({ cls: 'planner-suggestions' });
    const preview = body.createDiv({ cls: 'planner-edit-preview', attr: { 'aria-live': 'polite' } });
    const error = body.createDiv({ cls: 'planner-error', attr: { role: 'alert' } });
    const splitChoices = body.createDiv({ cls: 'planner-edit-splits' });
    const controls = body.createDiv({ cls: 'planner-edit-actions' });
    const saveButton = controls.createEl('button', { text: 'Save changes', cls: 'mod-cta', attr: { type: 'submit' } });
    this.button(controls, 'Cancel', () => cancel());
    let pending: Promise<boolean> | undefined;
    const result = () => compactEdit(day, entry, input.value, this.controller.now().time, this.controller.codesFor(day), { ...this.controller.settings, durationTouched });
    const update = () => {
      if (compactDuration(before) !== compactDuration(input.value)) durationTouched = true;
      before = input.value; durationHistory.remember(input.value, durationTouched);
      error.empty(); preview.empty(); splitChoices.empty(); refreshSuggestions();
      try {
        const next = result().entry, notes = interpretEntry(next, previous);
        const typed = compactDuration(input.value);
        if (typed && /(?:^|[-+|\s])0?\.\d/.test(typed)) notes.splice(1, 0, `Percent credit ${typed} saved as ${next.duration}.`);
        const typedTime = entryFields(input.value)?.time;
        if (this.controller.settings.roundTimes && typedTime && next.time && typedTime !== next.time && typedTime !== entry.time)
          notes.push(`Time rounded to ${next.time}.`);
        preview.empty();
        for (const note of notes) preview.createEl('p', { text: note });
        saveButton.disabled = false;
      } catch (e) {
        error.setText(message(e)); saveButton.disabled = true;
        // The same explicit allocation quick entry offers; it only fills the draft for review.
        for (const split of e instanceof EntryInputError ? e.splits : []) {
          const button = this.button(splitChoices, `Split equally: ${split.label}`, () => {
            input.value = split.input; durationTouched = true; update(); input.focus();
          }, 'planner-split-choice');
          button.title = 'Fill an explicit allocation for review. Nothing is saved until you save changes.';
        }
      }
    };
    const finish = async (targetRaw = entry.raw) => {
      this.activityEditor = undefined; editor.remove(); row.hidden = false; if (capture) capture.hidden = false;
      await this.refresh();
      // Locate the original row after harmless concurrent insertions, without
      // silently treating a neighboring activity as the edit target.
      const candidates = this.day?.entries.map((e, i) => ({ e, i })).filter(({ e }) => e.raw === targetRaw) ?? [];
      if (candidates.length === 1) this.selected = candidates[0]!.i;
      this.paintSelection();
      this.contentEl.querySelector<HTMLElement>(`.planner-row[data-index="${this.selected}"]`)?.focus();
    };
    const save = (): Promise<boolean> => {
      if (pending) return pending;
      pending = (async () => {
        try {
          const next = result();
          editor.setAttribute('aria-busy', 'true');
          for (const control of editor.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea')) control.disabled = true;
          if (next.change.patches.length) await this.controller.apply(next.change);
          await finish(next.entry.raw); return true;
        } catch (e) {
          error.setText(message(e)); editor.removeAttribute('aria-busy');
          for (const control of editor.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button, textarea')) control.disabled = false;
          return false;
        }
      })().finally(() => { pending = undefined; });
      return pending;
    };
    const cancel = async () => { if (!pending) await finish(); };
    this.activityEditor = { element: editor, input, dirty: () => input.value !== initial || durationTouched, save, cancel };
    editor.onsubmit = event => { event.preventDefault(); void save(); };
    const refreshSuggestions = this.bindActivitySuggestions(input, suggestions, update, text => error.setText(text));
    input.oninput = event => {
      const type = (event as InputEvent).inputType;
      if (type === 'historyUndo' || type === 'historyRedo') {
        durationTouched = durationHistory.restore(input.value, type === 'historyUndo' ? 'undo' : 'redo'); before = input.value;
      } else if (replacementIntent && !isDraftReplacement(input)) durationTouched = true;
      replacementIntent = false;
      update();
    };
    input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (this.completeActivity(event, input, update, text => error.setText(text))) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void cancel(); }
      else if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (!event.repeat) void save(); }
    });
    update(); input.focus();
    // Select the double-clicked part; Edit, E, Enter and F2 select the end time and minutes together.
    const [start, end] = editParts(initial, entry)[field];
    input.setSelectionRange(start, end); refreshSuggestions();
  }
  /** Keep the last textarea selection when a chip receives mouse or keyboard focus. */
  private bindActivitySuggestions(input: HTMLTextAreaElement, host: HTMLElement, changed: () => void, onError: (text: string) => void): () => void {
    let selection: [number, number] = [input.selectionStart, input.selectionEnd];
    const refresh = () => {
      if (input.ownerDocument.activeElement === input) selection = [input.selectionStart, input.selectionEnd];
      host.empty();
      let query = '', error = '', target = selection;
      try { query = activityTarget(input.value, ...selection).query; }
      catch (e) {
        // With only the end time and minutes selected (as Edit opens), a chip replaces the name.
        const name = scheduleNameRange(input.value, ...selection);
        if (name) target = name; else error = message(e);
      }
      host.setAttribute('aria-description', error || 'Replace the activity name at the caret; keep its time, minutes and context.');
      // Disabled chips say why, visibly, instead of only greying out.
      if (error) host.createEl('p', { text: error, cls: 'planner-suggestion-reason' });
      for (const label of matchHelpers(this.controller.helpersFor(this.day), query)) {
        const button = this.button(host, label, () => {
          try {
            const next = replaceActivityComponent(input.value, ...target, label);
            replaceDraft(input, next); selection = [next.caret, next.caret];
            input.setSelectionRange(...selection); input.focus(); changed(); refresh();
          } catch (e) { onError(message(e)); input.focus(); }
        }, 'planner-suggestion');
        button.disabled = !!error;
        const code = label.split(/[-\s]/)[0]!.toUpperCase();
        if (this.controller.codesFor(this.day).includes(code)) {
          button.addClass('planner-project-chip'); this.colorProject(button, code);
        }
      }
    };
    for (const event of ['keyup', 'click', 'select', 'focus'] as const) input.addEventListener(event, refresh);
    return refresh;
  }
  private completeActivity(event: KeyboardEvent, input: HTMLTextAreaElement, changed: () => void, onError: (text: string) => void): boolean {
    if (event.key !== 'Tab' || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return false;
    const completion = activityCompletion(input.value, input.selectionStart, input.selectionEnd, this.controller.helpersFor(this.day));
    if (!completion) return false;
    event.preventDefault(); event.stopPropagation();
    try { replaceDraft(input, completion); changed(); }
    catch (e) { onError(message(e)); }
    return true;
  }
  /**
   * Show the rest of the name Tab would complete, faint after the caret, with a small Tab
   * key. Only at the end of a line, so it never covers typed text; nothing is inserted.
   */
  private completionHint(input: HTMLTextAreaElement, body: HTMLElement): void {
    body.addClass('planner-has-completion');
    const ghost = body.createDiv({ cls: 'planner-completion-ghost', attr: { 'aria-hidden': 'true' } });
    const update = () => {
      ghost.empty(); ghost.hide();
      const { value, selectionStart: start, selectionEnd: end } = input;
      const lineEnd = value.indexOf('\n', start);
      if (input.ownerDocument.activeElement !== input || (lineEnd < 0 ? value.length : lineEnd) !== start) { input.removeAttribute('aria-description'); return; }
      const completion = activityCompletion(value, start, end, this.controller.helpersFor(this.day));
      if (!completion) { input.removeAttribute('aria-description'); return; }
      const rest = completion.suffix;
      input.setAttribute('aria-description', completion.fields ? `Tab completes ${completion.name} and writes the line with ; between fields` : `Tab completes ${completion.name}`);
      // Lay the overlay exactly over the field, with its font and padding, so the faint text follows the caret.
      const style = input.ownerDocument.defaultView!.getComputedStyle(input);
      ghost.setCssProps({
        '--planner-ghost-top': `${input.offsetTop}px`, '--planner-ghost-left': `${input.offsetLeft}px`,
        '--planner-ghost-width': `${input.offsetWidth}px`, '--planner-ghost-height': `${input.offsetHeight}px`,
        '--planner-ghost-font': style.font, '--planner-ghost-letter-spacing': style.letterSpacing, '--planner-ghost-line-height': style.lineHeight,
        '--planner-ghost-padding': `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
        '--planner-ghost-border': `${style.borderTopWidth} ${style.borderRightWidth} ${style.borderBottomWidth} ${style.borderLeftWidth}`
      });
      ghost.createSpan({ text: value.slice(0, start), cls: 'planner-completion-typed' });
      ghost.createSpan({ text: rest, cls: 'planner-completion-rest' });
      ghost.createSpan({ text: 'Tab', cls: 'planner-completion-key' });
      // The name would be misread in compact form, so Tab also separates the fields with ;.
      if (completion.fields) ghost.createSpan({ text: 'adds ; between fields', cls: 'planner-completion-note' });
      ghost.show(); ghost.scrollTop = input.scrollTop;
    };
    for (const name of ['input', 'keyup', 'click', 'focus', 'blur', 'scroll'] as const) input.addEventListener(name, update);
    update();
  }
  async toggle(): Promise<void> {
    if (this.activityEditor) { await this.leaveActivityEditor(() => this.toggle()); return; }
    const e = this.current();
    if (!e || !this.day) return;
    if (this.day.legacy) { await this.openSource(); return; }
    const row = this.contentEl.querySelector<HTMLElement>(`.planner-row[data-index="${this.selected}"]`);
    const checkbox = row?.querySelector<HTMLInputElement>('input[type=checkbox]');
    if (e.label === '...' || checkbox?.disabled) return;
    if (checkbox) checkbox.checked = !e.checked;
    row?.setAttribute('aria-busy', 'true');
    try { await this.controller.apply(toggleEntry(this.day, e)); }
    catch (error) { await this.refresh(); throw error; }
    finally { row?.removeAttribute('aria-busy'); }
  }
  edit(): void { void this.startActivityEdit(this.selected).catch(error => this.controller.report(error)); }
  async duplicate(): Promise<void> {
    if (this.whenEditorClosed(() => this.duplicate())) return;
    const e = this.current(), day = this.day;
    if (e && day) await this.controller.apply(insertRows(day, [e.raw.replace(/^(-\s+\[)[xX](\])/, '$1 $2')], e));
  }
  delete(): void {
    if (this.whenEditorClosed(() => this.delete())) return;
    const day = this.day, entries = this.selectedRows();
    if (!day || !entries.length) return;
    if (day.legacy) { void this.openSource(); return; }
    const count = entries.length, first = day.entries.indexOf(entries[0]!);
    const change = deleteEntries(day, entries);
    new ChoiceDialog(this.app, count > 1 ? `Delete ${count} activities` : 'Delete activity',
      count > 1 ? `Remove these ${count} selected activities? One Undo restores the operation.` : 'Remove this row? The operation can be undone.',
      count > 1 ? 'Delete rows' : 'Delete row', async () => {
        await this.controller.apply(change);
        return async () => {
          const current = await this.controller.getDay(this.date);
          const next = Math.min(first, (current?.entries.length ?? 0) - 1);
          this.selected = next; this.clearRowSelection(); await this.refresh();
          const focus = this.contentEl.querySelector<HTMLElement>(`.planner-row[data-index="${next}"]`)
            ?? this.contentEl.querySelector<HTMLElement>('.planner-section-add');
          focus?.focus();
        };
      }, entries.map(entry => entry.raw).join('\n')).focusAction().open();
  }
  async move(direction: -1 | 1): Promise<void> {
    if (this.whenEditorClosed(() => this.move(direction))) return;
    const e = this.current(), day = this.day;
    if (!e || !day || this.moving) return;
    const original = day.entries.indexOf(e);
    const change = moveEntry(day, e, direction);
    if (!change.patches.length) return;
    const planned = parseDay(applyPatches(day.text, change.patches), day.path, this.controller.codesFor(day));
    const plannedMatches = planned.entries.map((entry, index) => ({ entry, index })).filter(item => item.entry.raw === e.raw);
    const destination = plannedMatches.length === 1 ? plannedMatches[0]!.index : Math.max(0, Math.min(day.entries.length - 1, original + direction));
    this.moving = true;
    this.selected = destination; this.clearRowSelection();
    for (const button of this.contentEl.querySelectorAll<HTMLButtonElement>('[data-planner-move]')) button.disabled = true;
    try {
      await this.controller.apply(change);
      const current = await this.controller.getDay(this.date);
      const matches = current?.entries.map((entry, index) => ({ entry, index })).filter(item => item.entry.raw === e.raw) ?? [];
      this.selected = matches.length === 1 ? matches[0]!.index : destination;
    } catch (error) { this.selected = original; throw error; }
    finally {
      await this.refresh(); this.moving = false;
      for (const control of this.contentEl.querySelectorAll<HTMLButtonElement>('[data-planner-move]')) {
        const index = Number(control.closest<HTMLElement>('.planner-row')?.dataset.index);
        const entry = this.day?.entries[index];
        control.disabled = !this.day || !entry || this.day.legacy || !canMoveEntry(this.day, entry, control.dataset.plannerMove === 'up' ? -1 : 1);
      }
      const row = this.contentEl.querySelector<HTMLElement>(`.planner-row[data-index="${this.selected}"]`);
      const button = row?.querySelector<HTMLButtonElement>(`[data-planner-move="${direction === -1 ? 'up' : 'down'}"]`);
      if (button && !button.disabled) button.focus({ preventScroll: true }); else row?.focus({ preventScroll: true });
    }
  }
  shift(): void {
    if (this.whenEditorClosed(() => this.shift())) return;
    const day = this.day;
    if (!day) return;
    const entries = this.selectedRows();
    new ShiftDialog(this.app, entries.length, async (delta, durations) => { await this.controller.apply(shiftEntries(day, entries, delta, durations)); }).open();
  }
  correct(): void {
    if (this.whenEditorClosed(() => this.correct())) return;
    const day = this.day, entries = this.selectedRows();
    if (!day || !correctionChoices(day, entries).some(choice => choice.preview?.change.patches.length)) return;
    new CorrectDialog(this.app, day, entries, async change => { await this.controller.apply(change); }).open();
  }
  async compact(): Promise<void> {
    if (this.whenEditorClosed(() => this.compact())) return;
    if (!this.day) return;
    if (disputed(this.day)) { this.reconcile(); return; }
    await this.controller.apply(changeOf(this.day, footerPatches(this.day, true, this.controller.settings.projectCodes), 'Compact footer'));
  }
  reconcile(day = this.day, afterSave?: () => void): void {
    if (this.whenEditorClosed(() => this.reconcile(day, afterSave))) return;
    if (!day) return;
    try {
      const patches = footerPatches(day, false, this.controller.settings.projectCodes), after = applyPatches(day.text, patches);
      const totals = calculate(day);
      const comparison = day.footers.map(f => `${f.code}: ${f.value ?? '?'} -> ${f.code === 'SUM' ? totals.sum : totals.projects[f.code] ?? 0}`).join('\n');
      new ChoiceDialog(this.app, 'Reconcile daily totals',
        'Replace recorded footer totals with completed-entry credits. Activity durations and labels stay as written.', 'Use calculated totals',
        async () => { await this.controller.apply(changeOf(day, patches, 'Reconcile daily totals'), true); return afterSave; },
        `Recorded footer -> completed activities\n${comparison}\n\nProposed footer\n${after.slice(after.lastIndexOf('---'))}`).open();
    } catch (e) { this.controller.report(e); }
  }
  newDay(): void { new RoutineDialog(this.app, this.controller, this.date, day => { this.day = day; void this.refresh(); }).open(); }
  replacePlan(): void {
    if (this.whenEditorClosed(() => this.replacePlan())) return;
    this.switchMode('day');
    new ReplacePlanDialog(this.app, this.controller, this.date, () => {
      this.selected = -1; this.clearRowSelection(); void this.refresh();
    }).open();
  }
  async openSource(): Promise<void> {
    if (this.whenEditorClosed(() => this.openSource())) return;
    if (this.day) await this.controller.openSource(this.day.path, this.current()?.line ?? 0); }
  private setCaptureOpen(open: boolean): void {
    if (this.captureOpen && !open) {
      const input = this.contentEl.querySelector<HTMLTextAreaElement>('[data-planner-key="quick-entry"]');
      if (input) this.draftSelection = [input.selectionStart, input.selectionEnd];
    }
    this.captureOpen = open;
    const form = this.contentEl.querySelector<HTMLElement>('.planner-capture');
    if (!form) return;
    form.classList.toggle('is-collapsed', !open);
    form.classList.toggle('is-open', open);
    form.classList.toggle('has-draft', !!this.draft.trim());
    const body = form.querySelector<HTMLElement>('.planner-capture-reveal');
    if (body) { body.inert = !open; body.setAttribute('aria-hidden', String(!open)); }
    const toggle = form.querySelector<HTMLButtonElement>('.planner-capture-toggle');
    if (toggle) {
      toggle.textContent = open ? '' : this.draft.trim() ? 'Continue your activity...' : 'Add an activity...';
      if (open) { const icon = toggle.createSpan({ attr: { 'aria-hidden': 'true' } }); setIcon(icon, 'x'); }
      this.accessibleName(toggle, open ? 'Collapse activity editor' : this.draft.trim() ? 'Continue your activity' : 'Add an activity');
      toggle.setAttribute('aria-expanded', String(open));
      toggle.removeAttribute('title');
    }
  }
  focusEntry(): void {
    if (this.activityEditor) { void this.leaveActivityEditor(() => this.focusEntry()); return; }
    if (this.day?.recordedOnly) { void this.openSource(); return; }
    this.setCaptureOpen(true);
    const input = this.contentEl.querySelector<HTMLTextAreaElement>('[data-planner-key="quick-entry"]');
    input?.focus();
    if (input && this.draftSelection) input.setSelectionRange(...this.draftSelection);
    this.draftSelection = undefined;
  }
  private focusCaptureInvitation(): void {
    const toggle = this.contentEl.querySelector<HTMLButtonElement>('.planner-capture-toggle');
    if (toggle?.getClientRects().length) toggle.focus();
    else this.contentEl.querySelector<HTMLButtonElement>('.planner-row.is-current .planner-add-below')?.focus();
  }
  async capture(mode: 'log' | 'plan'): Promise<void> {
    if (this.activityEditor) { await this.leaveActivityEditor(() => this.capture(mode)); return; }
    this.entryMode = mode; this.switchMode('day'); await this.refresh(); this.focusEntry();
  }
  recovery(): void {
    if (this.whenEditorClosed(() => this.recovery())) return;
    const operations = this.controller.journal.data.operations.filter(o => o.state === 'interrupted' || o.state === 'pending');
    if (!operations.length) { void this.controller.retrySummary(); return; }
    const names: Record<string, string> = { [REGISTRY_PATH]: 'Project codes and groups', [EMOJI_PATH]: 'Project emojis', [PROJECT_SOURCES_PATH]: 'Note and template list' };
    const name = (path: string) => names[path] ?? path.split('/').pop()!;
    const when = (time: number) => new Date(time).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    // Plain lines per edit: what was saved, what is left, and what is checked first.
    const details = operations.map(o => {
      const checked = Object.keys(o.guards ?? {}).length;
      const problem = this.controller.issues.get(`checkpoint:${o.id}`);
      const lines = isSummaryCheckpoint(o)
        ? [`${o.label} (${when(o.time)}): summary check only. Nothing will be written.`, ...o.writes.map(w => `   confirms the summary still matches ${name(w.path)}`)]
        : [`${o.label} (${when(o.time)})`,
          ...o.writes.filter(isChange).map(w => w.state === 'saved' ? `   saved: ${name(w.path)}` : `   not finished: ${name(w.path)}`),
          ...(checked ? [`   first checks that ${checked.toLocaleString()} other note${checked === 1 ? ' is' : 's are'} unchanged`] : [])];
      return [...lines, ...(problem ? [`   problem: ${problem}`] : [])].join('\n');
    }).join('\n\n');
    const count = operations.length;
    new ChoiceDialog(this.app, 'Finish interrupted edits',
      `${count} planner edit${count === 1 ? '' : 's'} stopped partway, for example because Obsidian closed while saving. Your notes are safe: nothing was lost. ` +
      'Finishing completes the parts marked "not finished". If any note changed since, the planner stops and names it, without writing anything.',
      'Finish safely', async () => { await this.controller.recover(); }, details, true,
      container => {
        for (const path of new Set(operations.flatMap(o => o.writes.map(w => w.path)).filter(path => !path.startsWith('@'))))
          this.button(container, `open note | ${path}`, () => this.controller.openSource(path));
        const dates = operations.flatMap(o => o.writes.map(w => dateFromPath(w.path))).filter((date): date is string => date !== null);
        for (const summary of this.controller.summaries.values()) if (summary.start && summary.end && dates.some(date => summary.start! <= date && date <= summary.end!))
          this.button(container, `open summary | ${summary.path}`, () => this.controller.openSource(summary.path));
      }).open();
  }
  /** Compare a summary (the configured one by default) with the daily notes before updating it. */
  async summaryPreview(path = this.controller.settings.summaryPath): Promise<void> {
    if (this.whenEditorClosed(() => this.summaryPreview(path))) return;
    await this.controller.recheckSummary();
    // Preview the note as it is now; Update summary refuses if it changes before confirming.
    const summary = await this.controller.readSummary(path);
    if (!summary) { this.controller.report(new Error(`${path} was not found. Choose Check again, or Rebuild index if it was moved.`)); return; }
    if (!summary.start || !summary.end) { this.controller.report(new Error('The summary has no readable Days line (YYYY-MM-DD - YYYY-MM-DD). Open the summary note and fix it.')); return; }
    const through = this.controller.now().date, totals = summaryTotals(summary, this.controller.days.values(), through) ?? undefined;
    const update = summaryPatches(summary, this.controller.days.values(), through, new Set(), true, totals);
    // Name each differing project with both figures before the line-by-line changes.
    const differences = projectDifferences(summary, totals);
    const projects = differences.length ? 'Project totals that differ:\n' + differences.map(d => `  ${differenceLine(d)}`).join('\n') +
      '\n\nUpdate summary replaces the summary\'s figures with the totals from your daily notes, including any figure typed by hand. ' +
      'If a summary figure is right, correct the daily notes instead.\n\n' : '';
    const preview = projects + (update.patches.length ? 'Lines marked - are in the summary now; lines marked + would replace them.\n\n' + update.patches.map(p => {
      const before = summary.text.slice(p.start, p.end);
      return (before ? before.split(/\r?\n/).map(line => `- ${line}`).join('\n') + '\n' : '') +
        p.after.trimEnd().split(/\r?\n/).map(line => `+ ${line}`).join('\n');
    }).join('\n\n') : update.issues.length ? 'The summary matches every day that is ready. Fix the days below to finish.' : `This summary (${summary.start} - ${summary.end}) is up to date.`) +
      (this.controller.issues.has('recovery') ? '\n\nSome interrupted edits also need finishing. Choose Finish interrupted edits in the attention panel.' : '');
    const actionLabel = update.patches.length ? 'Update summary' : update.issues.length ? 'Fix the days below' : 'Done';
    const name = path === this.controller.settings.summaryPath ? 'the summary' : `${summary.path.split('/').pop()!.replace(/\.md$/i, '')} (${summary.start} - ${summary.end})`;
    new ChoiceDialog(this.app, 'Review summary',
      `This compares ${name} with your daily notes. Nothing changes until you choose Update summary.`, actionLabel,
      async () => { if (update.patches.length) await this.controller.reconcileSummary(path, { text: summary.text, patches: update.patches }); }, preview, update.patches.length > 0 || !update.issues.length,
      (container, dialog) => {
        if (!update.issues.length) return;
        const list = container.createDiv({ cls: 'planner-reconcile-issues' });
        list.createEl('h3', { text: 'Days to fix first' });
        const refresh = () => { dialog.close(); void this.summaryPreview(path).catch(e => this.controller.report(e)); };
        this.button(list, 'Refresh', refresh, 'planner-reconcile-refresh');
        if (update.issues.some(issue => !/^\d{4}-\d{2}-\d{2}:/.test(issue))) this.button(list, 'Open summary note', async () => {
          dialog.close(); await this.controller.openSource(summary.path);
        }, 'planner-reconcile-summary-source');
        for (const issue of update.issues) {
          const date = /^(\d{4}-\d{2}-\d{2}):/.exec(issue)?.[1];
          if (!date) { list.createEl('p', { text: issue, cls: 'planner-muted' }); continue; }
          const matches = [...this.controller.days.values()].filter(d => d.date === date);
          const item = list.createDiv({ cls: 'planner-reconcile-issue' });
          const heading = item.createDiv({ cls: 'planner-reconcile-day' });
          this.button(heading, date, async () => {
            dialog.close(); this.mode = 'day'; await this.navigate(date);
          }, 'planner-reconcile-date');
          if (matches.length === 1) {
            const day = matches[0]!, totals = calculate(day);
            heading.createSpan({ text: `note total ${day.recordedSum ?? '?'}m | activities ${totals.complete ? totals.sum + 'm' : 'incomplete'}`, cls: 'planner-muted' });
            const reasons = day.diagnostics.filter(d => d.code !== 'total-conflict').map(d => d.message);
            item.createEl('p', { text: reasons.join(' ') || (day.legacy ? 'This day uses an older format. Fix it in the note itself.' : 'The total at the bottom of this note differs from its completed activities. Compare them before replacing it.') });
            const actions = item.createDiv({ cls: 'planner-dialog-actions' });
            if (!day.legacy && totals.complete && !day.diagnostics.some(d => d.blocks) && disputed(day)) {
              const review = this.button(actions, 'Review totals', () => this.reconcile(day, refresh));
              review.title = 'Compare the note total with its completed activities. After saving, you return here.';
            }
            const source = this.button(actions, 'Open note', async () => {
              dialog.close(); await this.controller.openSource(day.path, day.diagnostics.find(d => d.blocks)?.line ?? day.diagnostics[0]?.line ?? 0);
            });
            source.title = 'Open the note at the problem line to fix it.';
          } else if (matches.length > 1) {
            item.createEl('p', { text: 'More than one note has this date. Open them and keep only one.' });
            const actions = item.createDiv({ cls: 'planner-dialog-actions' });
            for (const day of matches) this.button(actions, day.path, async () => { dialog.close(); await this.controller.openSource(day.path); });
          } else {
            item.createEl('p', { text: issue.includes('duplicate summary') ? 'The summary has this date more than once. Open the summary note and keep one row.' : 'There is no daily note for this date. Open the day to create or check it.' });
          }
          if (issue.includes('duplicate summary')) this.button(item, 'Open summary note', async () => {
            dialog.close(); await this.controller.openSource(summary.path, summary.rows.find(r => r.date === date)?.line ?? 0);
          });
        }
      }).open();
  }
  async context(): Promise<void> {
    if (this.whenEditorClosed(() => this.context())) return;
    if (this.contextOpening) return;
    this.contextOpening = true;
    const date = this.day?.date ?? this.date;
    try {
      const snapshot = await this.controller.contextForDate(date);
      if (this.date !== date) return;
      new ContextDialog(this.app, snapshot, value => this.controller.setContext(date, value, snapshot)).open();
    } catch (error) { this.controller.report(error); }
    finally { this.contextOpening = false; }
  }
  private drawReview(parent: HTMLElement): void {
    const filters = parent.createDiv({ cls: 'planner-review-filters' });
    const controls = filters.createDiv({ cls: 'planner-review-controls' });
    const summary = this.controller.summaries.get(this.controller.settings.summaryPath);
    const preset = controls.createEl('select', { attr: { 'aria-label': 'Review period' } });
    const presets = [['7days', 'Past 7 days'], ['30days', 'Past 30 days'], ['6months', 'Past 6 months'],
      ['12months', 'Past 12 months'], ['period', 'This summary period'], ['all', 'All data']];
    for (const [value, label] of presets) preset.createEl('option', { value, text: label });
    if (this.preset === 'custom') preset.createEl('option', { value: 'custom', text: 'Custom range' });
    preset.value = this.preset;
    preset.onchange = () => { this.preset = preset.value; this.page = 0; this.draw(); };
    let range: { start: string; end: string };
    try { range = this.preset === 'custom' ? { start: this.rangeStart, end: this.rangeEnd } : rangeFor(this.preset, this.controller.now().date, summary, this.controller.days.values(), [...this.controller.summaries.values()]); }
    catch (error) { parent.createEl('p', { text: message(error), cls: 'planner-error' }); return; }
    this.rangeStart = range.start; this.rangeEnd = range.end;
    const rangeNote = this.preset === 'custom' ? 'Both dates are included.'
      : this.preset === '6months' || this.preset === '12months' ? 'Includes today; uses calendar months.' : 'Includes today.';
    filters.createEl('p', { text: rangeNote, cls: 'planner-muted planner-review-range-note' });
    for (const side of ['start', 'end'] as const) {
      this.dateField(controls, range[side], `Review ${side} date`, date => {
        this.preset = 'custom'; if (side === 'start') this.rangeStart = date; else this.rangeEnd = date; this.page = 0; this.draw();
      }).dataset.plannerKey = `review-${side}`;
    }
    const project = controls.createEl('select', { attr: { 'aria-label': 'Project filter' } });
    project.createEl('option', { value: '', text: 'All projects' });
    for (const code of orderedCodes(this.controller.projectCodes(), this.controller.settings.projectCodes)) project.createEl('option', { value: code, text: code });
    project.value = this.project; project.onchange = () => { this.project = project.value; this.page = 0; this.draw(); };
    const actions = filters.createDiv({ cls: 'planner-review-actions' });
    this.button(actions, 'Sort summary projects', () => this.controller.sortSummaryProjects());
    let result;
    try { result = review(this.controller.days.values(), range.start, range.end, this.project, [...this.controller.summaries.values()]); }
    catch (error) { parent.createEl('p', { text: message(error), cls: 'planner-error' }); return; }
    const overview = parent.createDiv({ cls: 'planner-review-section planner-review-overview' });
    overview.createEl('h2', { text: uiText(reviewDescription(result)), cls: 'planner-review-total' });
    overview.createEl('p', { text: `Average uses ${result.knownDays} days with known totals; ${result.missingDays} unknown days are excluded, not counted as zero.`, cls: 'planner-muted' });
    const registeredProjects = Object.fromEntries(Object.entries(result.projects).filter(([code]) => this.controller.projectCodes().includes(code)));
    const workTotal = workShareTotal(result, this.project);
    const grouped = groupTotals(this.controller.settings.projectGroups, registeredProjects, this.project, this.controller.projectCodes())
      .sort((a, b) => b.minutes - a.minutes);
    if (grouped.length) {
      const groups = parent.createDiv({ cls: 'planner-review-section planner-group-totals', attr: { 'aria-label': 'Project group totals' } });
      for (const group of grouped) {
        const item = groups.createDiv({ cls: 'planner-group-total' });
        item.createEl('strong', { text: group.name });
        item.createSpan({ text: displayMinutes(group.minutes) });
        this.share(item, group.minutes, workTotal, 'selected work');
      }
    }
    const totals = parent.createDiv({ cls: 'planner-review-section planner-project-totals planner-ranked-projects', attr: { 'aria-label': 'Project totals' } });
    const rankedCodes = Object.keys(registeredProjects).sort((a, b) => result.projects[b]! - result.projects[a]!)
      .filter(code => !this.project || this.project === code);
    rankedCodes.forEach((code, index) => this.projectChip(totals, code, result.projects[code]!, workTotal, index + 1));
    if (this.controller.settings.showMarkerCounts) {
      // One criteria note serves every summary; without it there are no markers to count.
      const criteria = this.controller.criteria() ?? parseMarkerCriteria('', 'thejaz-criteria.md'), path = this.controller.criteriaPath();
      const markers = markerCounts(this.controller.summaries.values(), range.start, range.end, criteria, this.controller.settings.weekendDays, true);
      const section = parent.createDiv({ cls: 'planner-review-section planner-marker-summary', attr: { 'aria-label': 'Recorded day markers' } });
      const counts = section.createDiv({ cls: 'planner-marker-counts' });
      const rankedMarkers = criteria.definitions.filter(def => !def.formatting)
        .sort((a, b) => (markers.counts.get(b.key) ?? 0) - (markers.counts.get(a.key) ?? 0));
      for (const [index, definition] of rankedMarkers.entries()) {
        const count = markers.counts.get(definition.key) ?? 0;
        const description = `${definition.label}: ${count} ${count === 1 ? 'day' : 'days'}`;
        const item = counts.createSpan({ cls: 'planner-marker-count', attr: { title: description, 'aria-label': description } });
        item.createSpan({ text: `${index + 1}.`, cls: 'planner-marker-rank', attr: { 'aria-hidden': 'true' } });
        item.createSpan({ text: definition.symbol, cls: 'planner-marker-symbol', attr: { 'aria-hidden': 'true' } });
        item.createSpan({ text: uiText(definition.label), cls: 'planner-marker-label' });
        const value = item.createSpan({ cls: 'planner-marker-values' });
        value.createEl('strong', { text: String(count), cls: 'planner-marker-value' });
        this.share(value, count, markers.countedDays, 'recorded summary days');
        item.dataset.marker = definition.key;
      }
      section.createEl('p', { text: `Recorded summary markers | ${markers.countedDays} days | percentages use these days; contexts can overlap. Independent of the project filter.`, cls: 'planner-marker-note' });
      if (markers.issues.length) {
        const checks = section.createEl('details', { cls: 'planner-marker-checks' });
        checks.createEl('summary', { text: `${markers.issues.length} marker ${markers.issues.length === 1 ? 'check' : 'checks'}` });
        checks.createEl('p', { text: 'Counts keep the saved markers. Correct the linked summary row or its criterion; for weekend mismatches, check Weekend days in Planner settings. Nothing is repaired automatically.' });
        const list = checks.createDiv();
        const show = (limit: number) => {
          list.empty();
          for (const issue of markers.issues.slice(0, limit)) {
            const item = list.createDiv({ cls: 'planner-marker-issue' });
            item.createSpan({ text: uiText(issue.message) });
            this.button(item, 'Open source line', () => this.controller.openSource(issue.path, issue.line), 'planner-text-button');
          }
          if (limit < markers.issues.length) this.button(list, `Show all ${markers.issues.length} checks`, () => show(markers.issues.length), 'planner-text-button');
        };
        show(30);
        if (path) this.button(checks, 'Open criteria source', () => this.controller.openSource(path), 'planner-text-button');
      }
    }
    const records = parent.createEl('details', { cls: 'planner-review-section planner-day-records' });
    records.open = this.recordsOpen;
    records.createEl('summary', { text: `Day records | ${result.rows.length} days` });
    records.ontoggle = () => { if (records.isConnected) this.recordsOpen = records.open; };
    const table = records.createEl('table', { cls: 'planner-review-table' });
    const head = table.createEl('thead').createEl('tr');
    for (const label of ['Date', 'Credit', 'Record']) head.createEl('th', { text: label });
    const body = table.createEl('tbody'), rows = [...result.rows].reverse(), pageSize = 60;
    for (const row of rows.slice(this.page * pageSize, (this.page + 1) * pageSize)) {
      const tr = body.createEl('tr'), dateCell = tr.createEl('td');
      this.button(dateCell, row.date, () => { this.mode = 'day'; return this.navigate(row.date); }, 'planner-text-button');
      tr.createEl('td', { text: row.sum === null ? '?' : displayMinutes(row.sum), cls: 'planner-numeric' });
      const source = tr.createEl('td');
      source.createSpan({ text: row.source, cls: 'planner-record-kind' });
      if (row.disputed) source.createSpan({ text: 'check totals', cls: 'planner-status' });
      if (row.unallocated) source.createSpan({ text: this.unallocatedText(row.unallocated), cls: 'planner-record-note' });
      if (row.issues.length || row.paths.length) {
        const detail = source.createEl('details');
        detail.createEl('summary', { text: 'Evidence' });
        for (const path of row.paths) this.button(detail, path, () => this.controller.openSource(path), 'planner-text-button');
        for (const issue of row.issues) detail.createEl('p', { text: issue });
      }
    }
    if (rows.length > pageSize) {
      const pages = records.createDiv({ cls: 'planner-pagination' });
      const prev = this.button(pages, 'Previous page', () => { this.page--; this.draw(); }); prev.disabled = this.page === 0;
      pages.createSpan({ text: `${this.page + 1} / ${Math.ceil(rows.length / pageSize)}` });
      const next = this.button(pages, 'Next page', () => { this.page++; this.draw(); }); next.disabled = (this.page + 1) * pageSize >= rows.length;
    }
  }
  private keyboard(event: KeyboardEvent): void {
    const target = event.target as HTMLElement, typing = !!target.closest('input, textarea, select, [contenteditable]:not([contenteditable=false]), [role=textbox], [role=combobox]');
    if (event.isComposing) return;
    if (this.activityEditor && target.closest('.planner-activity-editor')) {
      if (event.key === 'Escape') { event.preventDefault(); void this.activityEditor.cancel(); }
      else if (event.key === 'Enter' && typing) { event.preventDefault(); void this.activityEditor.save(); }
      return;
    }
    if (target.matches('textarea[data-planner-key="quick-entry"]') && event.key === 'Enter') {
      if (event.shiftKey && !event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      if (event.repeat) return;
      if (event.ctrlKey || event.metaKey) {
        const input = target as HTMLTextAreaElement;
        input.setRangeText('\n', input.selectionStart, input.selectionEnd, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } else void this.submit().catch(e => this.controller.report(e));
      return;
    }
    if (event.key === 'Escape' && typing) {
      event.preventDefault();
      this.dateCancels.get(target)?.();
      if (target.closest('.planner-capture')) {
        this.setCaptureOpen(false); this.focusCaptureInvitation();
      } else { target.blur(); this.contentEl.querySelector<HTMLElement>(`.planner-row[data-index="${Math.max(this.selected, 0)}"]`)?.focus(); }
      return;
    }
    if (typing) return;
    const onRow = target.classList.contains('planner-row') && !!this.day;
    const shortcut = shortcutFor(event, { onRow, activity: this.mode === 'day' && !!this.day?.entries.length });
    if (!shortcut) return;
    if (shortcut.action in ROW_SHORTCUTS) {
      if (!onRow && target.closest('[aria-haspopup], summary, [role=menu], [role=menuitem], [role=tablist]')) return;
      if (event.repeat) { event.preventDefault(); return; }
    }
    if (shortcut.action === 'day-context' && this.mode !== 'day') return;
    // Menus, the composer, selects and disclosures keep their own arrow keys.
    const ownsArrows = !onRow && !!target.closest('.planner-capture, .planner-activity-editor, .planner-choice-menu, [aria-haspopup], select, details, summary');
    if ((shortcut.action === 'previous' || shortcut.action === 'next') && ownsArrows) return;
    event.preventDefault();
    this.runShortcut(shortcut.action, onRow);
  }
  private runShortcut(action: ShortcutAction, onRow: boolean): void {
    const run = (task: unknown) => { void Promise.resolve(task).catch(error => this.controller.report(error)); };
    switch (action) {
      case 'previous': case 'next':
        // From another control, the first arrow press lands on the selected activity.
        if (onRow) this.step(action === 'next' ? 1 : -1, false); else this.focusActivities();
        return;
      case 'extend-previous': case 'extend-next': this.step(action === 'extend-next' ? 1 : -1, true); return;
      case 'edit': run(this.startActivityEdit(Math.max(this.selected, 0))); return;
      case 'toggle': run(this.toggle()); return;
      case 'add-below': case 'shift': case 'correct': case 'duplicate': case 'move-up': case 'move-down': case 'delete': this.invokeRowShortcut(action); return;
      case 'open-source': run(this.openSource()); return;
      case 'toggle-view': this.toggleMode(); return;
      case 'day-context': run(this.context()); return;
      case 'settings': try { openPlannerSettings(this.app); } catch (error) { this.controller.report(error); } return;
      case 'help': new HelpDialog(this.app).open(); return;
      case 'undo': run(this.controller.undo()); return;
      case 'redo': run(this.controller.redo()); return;
    }
  }
  private step(direction: 1 | -1, extend: boolean): void {
    if (!this.day?.entries.length) return;
    const next = Math.min(this.day.entries.length - 1, Math.max(0, this.selected + direction));
    if (this.activityEditor) { void this.leaveActivityEditor(() => this.selectActivity(next)); return; }
    this.closeCaptureForSelection(next);
    if (extend) this.extendRowSelection(next); else { this.selected = next; this.clearRowSelection(); }
    this.paintSelection();
    this.contentEl.querySelector<HTMLElement>(`.planner-row[data-index="${next}"]`)?.focus();
  }
}
