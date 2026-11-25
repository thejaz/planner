import { Notice, TFile, TFolder, normalizePath } from 'obsidian';
import type { App, Plugin } from 'obsidian';
import { DATE_ONLY, dailyAffixProblem, dailyNameAffixes, dailyNotePath, dateFromPath, localNow, normalizeDailyName, setDailyNameAffixes, systemTimeZone } from './core/model';
import type { DailyName } from './core/model';
import { dataRecord, stringItems } from './core/settings-data';
import { activityHelpers, DEFAULT_ACTIVITY_HELPERS, upgradedHelpers } from './core/activity-helpers';
import type { Change, Day, Patch } from './core/model';
import { adoptDay, applyPatches, changeOf, Conflict, footerPatches, makeDay, minimalDiff, NameTaken, patch } from './core/changes';
import { calculate, disputed, footerSignature, parseDay, userDisputed } from './core/reader';
import { newProjectPatch, projectCode } from './core/projects';
import { replacePlan } from './core/plan-template';
import type { PlanReplacement } from './core/plan-template';
import { removeProject } from './core/project-removal';
import type { ProjectRemoval } from './core/project-removal';
import { transferProject } from './core/project-transfer';
import type { ProjectDocument, ProjectTransfer, ProjectTransferMode } from './core/project-transfer';
import { ENTRY_DEFAULTS, normalizeEntryDefaults, validateEntryDefaults } from './core/entry-defaults';
import type { EntryDefaults } from './core/entry-defaults';
import { IndexedDays } from './core/activity-occurrences';
import { isSummaryPath, materialPatches, parseSummary, recordedReviewRows, review, sortedProjectPatches, summaryBests, summaryPatches } from './core/history';
import type { Review, Summary } from './core/history';
import { projectDifferences, settlePending, TotalsMemo, WAITING, waitingMessage } from './core/summary-totals';
import { hotStreak } from './core/streaks';
import { dayRecords } from './core/records';
import { ORDINARY_DAY_NAME, ORDINARY_DAY_NOTE, ORDINARY_DAY_OFFER } from './core/ordinary-day';
import type { RoutineChoice } from './core/ordinary-day';
import { activeIgnores } from './core/ignored-checks';
import type { DayRecord } from './core/records';
import type { HotStreak } from './core/streaks';
import { Journal, isSummaryCheckpoint, writeTexts } from './storage/journal';
import { checkpointIssues } from './core/checkpoint';
import type { JournalData, Operation } from './storage/journal';
import { ObsidianPort } from './storage/obsidian-port';
import { message } from './ui/text';
import { totalLine } from './core/syntax';
import { contextPatch, readContext } from './core/context';
import type { DayContext, ContextSnapshot } from './core/context';
import { normalizeGroups, normalizeWeekends, parseMarkerCriteria } from './core/review-extras';
import type { ProjectGroup } from './core/review-extras';
import { CRITERIA_NOTE, isCriteriaPath, vaultCriteria } from './core/criteria';
import { chooseDay, folderCounts } from './core/day-choice';
import { isPlannerDay } from './core/syntax';
import type { MarkerCriteria } from './core/marker-rules';
import { codesFromParsed, isRoutine, isRoutineSummary, missingProjectChanges, normalizedCodes, projectValue, routinesRoot, summaryForDate } from './core/project-registry';
import type { FilePort } from './storage/journal';
import { assignProjectEmojis, normalizedEmojis, projectEmoji, randomProjectEmoji, summaryEmojiChanges } from './core/project-emojis';
import type { EmojiConflict, ProjectEmojis } from './core/project-emojis';
import { TransientNotices, groupDays } from './core/notices';
import { reusableEntry } from './core/index-cache';
import type { CacheEntry } from './core/index-cache';
export const EMOJI_PATH = '@planner-project-emojis';
export const REGISTRY_PATH = '@planner-project-registry';
export const PROJECT_SOURCES_PATH = '@planner-project-sources';
/** Indexing works for this long before letting the interface draw; shorter pauses cost more than the work. */
const INDEX_SLICE_MS = 8;
/** The view redraws at most this often while indexing. */
const INDEX_PROGRESS_MS = 250;
/** An identical message within this interval is not shown as another pop-up. */
const NOTICE_REPEAT_MS = 10_000;
/** Where the complete list of days behind a shortened summary message is shown. */
/** What a Review summary showed: the summary text and the changes Update summary would make. */
interface SummaryPreview { text: string; patches: Patch[] }
const PREVIEW_CHANGED = 'The summary or its daily notes changed after this preview, so nothing was written. Close this and choose Review summary again.';
const SEE_REVIEW = 'Choose Review summary to see them all.';
export type ProjectTransferPreview = ProjectTransfer & { registry: string; emojis: string; scope: string; summaryPath: string; routinesFolder: string };

export interface Settings extends EntryDefaults {
  summaryPath: string; routinesFolder: string; lastRoutine: string; timezone: string;
  /** New daily note names: the date alone (default), or a prefix or suffix around it. */
  dailyName: DailyName;
  /** Earlier prefix or suffix names: days made under them keep counting (0.2.141). */
  dailyNamesUsed: DailyName[];
  autoUpdate: boolean; projectCodes: string[]; projectEmojis: ProjectEmojis;
  projectGroups: ProjectGroup[]; weekendDays: number[]; showMarkerCounts: boolean;
  /** Lowercase activity names offered while typing; project codes are added automatically. */
  activityHelpers: string[];
  activityHelperDefaultsVersion?: number;
  /** Note checks the owner chose to ignore, by row fingerprint (see core/ignored-checks). */
  ignoredChecks: string[];
}
export type GeneralSettings = Partial<Pick<Settings, 'autoUpdate' | 'summaryPath' | 'routinesFolder' | 'timezone' | 'dailyName' | 'activityHelpers'>>;
type ReviewPreferences = Partial<Pick<Settings, 'projectGroups' | 'weekendDays' | 'showMarkerCounts'>>;
/** The two alternating recovery snapshots in the plugin folder. */
const RECOVERY_FILES = ['recovery-0.json', 'recovery-1.json'];
/** Attention entry for recovery history that could not be read at startup. */
const RECOVERY_HISTORY = 'recovery-history';
const DEFAULTS: Settings = {
  ...ENTRY_DEFAULTS,
  summaryPath: 'thejaz-summary-now.md', routinesFolder: 'THEJAZ', lastRoutine: '', dailyName: DATE_ONLY, dailyNamesUsed: [],
  timezone: systemTimeZone(), autoUpdate: true, projectCodes: [], projectEmojis: {},
  projectGroups: [], weekendDays: [5], showMarkerCounts: true,
  activityHelpers: [...DEFAULT_ACTIVITY_HELPERS], ignoredChecks: []
};
export class Controller {
  readonly days = new IndexedDays();
  readonly summaries = new Map<string, Summary>();
  /** Notes named thejaz-criteria.md, by path; exactly one is expected. */
  private criteriaNotes = new Map<string, string>();
  readonly ownWrites = new Set<string>();
  readonly listeners = new Set<(projectChange?: { from: string; to: string }) => void>();
  readonly issues = new Map<string, string>();
  private readonly notices = new TransientNotices(this.issues);
  readonly performance = { indexSlices: [] as number[], operations: [] as number[], warmOpens: [] as number[], automaticUpdates: [] as number[],
    /** Each indexing run: when it started and finished, and how many notes came from the cache or were read. */
    indexRuns: [] as { started: number; finished: number; cached: number; read: number }[] };
  readonly port: ObsidianPort;
  readonly journal: Journal;
  settings: Settings = structuredClone(DEFAULTS);
  indexed = false;
  indexing = false;
  initialized = false;
  /** Settles when recovery records are loaded; edits made earlier wait for it instead of failing. */
  private readonly started: Promise<void>;
  private settleStart!: (error?: unknown) => void;
  /** Saved edits whose summary update waits for indexing; finished automatically when it completes. */
  private deferredSummaries = new Set<string>();
  /** Summaries whose automatic update stopped because their project totals differ from the daily notes. */
  private pausedSummaries = new Set<string>();
  private alive = true;
  get isAlive(): boolean { return this.alive; }
  private timers = new Map<string, number>();
  private baselines = new Map<string, Day | undefined>();
  /**
   * Notes edited since their last automatic update read them. An entry outlives its debounce
   * timer while that update waits in the queue, so a confirmation queued first still sees it.
   */
  private unindexed = new Set<string>();
  private cacheTimer: number | undefined;
  private reindexTimer: number | undefined;
  private reindexRequested = false;
  private cacheVerified = new Map<string, CacheEntry>();
  private mutation: Promise<unknown> = Promise.resolve();
  private recoverySequence = 0;
  private routinePaths = new Set<string>();
  /** Dated summaries filed in the routines folder; other files there are templates. */
  private routineSummaries = new Set<string>();
  private jsonQueue: Promise<unknown> = Promise.resolve();
  private config: string;
  private recoveryPort: FilePort;
  constructor(readonly app: App, private plugin: Plugin) {
    this.config = normalizePath(`${app.vault.configDir}/plugins/${plugin.manifest.id}`);
    this.port = new ObsidianPort(app, this.ownWrites);
    this.recoveryPort = {
      read: path => path === PROJECT_SOURCES_PATH ? Promise.resolve(this.transferScopeText()) : path === EMOJI_PATH ? this.emojiText() : path === REGISTRY_PATH ? this.registryText() : this.port.read(path),
      replace: async (path, expected, text) => {
        if (path === PROJECT_SOURCES_PATH) throw new Error('Project source lists are read-only recovery checkpoints.');
        if (path === EMOJI_PATH) {
          if (await this.emojiText() !== expected) throw new Conflict('Project emojis changed. Refresh before retrying.');
          const projectEmojis = normalizedEmojis(JSON.parse(text));
          const latest = dataRecord(await this.plugin.loadData());
          // In-memory settings are current; only the project field being written changes.
          const next = { ...withoutRetired(latest), ...this.settings, projectEmojis };
          await this.plugin.saveData(next); Object.assign(this.settings, next); return;
        }
        if (path !== REGISTRY_PATH) return this.port.replace(path, expected, text);
        if (await this.registryText() !== expected) throw new Conflict('Project settings changed. Refresh before retrying.');
        const value = dataRecord(JSON.parse(text));
        if (!Array.isArray(value.projectCodes) || !Array.isArray(value.projectGroups)) throw new Error('Invalid project recovery snapshot.');
        const latest = dataRecord(await this.plugin.loadData());
        const next = { ...withoutRetired(latest), ...this.settings, projectCodes: normalizedCodes(stringItems(value.projectCodes)), projectGroups: normalizeGroups(value.projectGroups) };
        await this.plugin.saveData(next); Object.assign(this.settings, next);
      },
      removeCreated: (path, expected) => { if ([REGISTRY_PATH, EMOJI_PATH, PROJECT_SOURCES_PATH].includes(path)) throw new Error('Project settings cannot be deleted.'); return this.port.removeCreated(path, expected); }
    };
    this.journal = new Journal(this.recoveryPort, data => this.persistJournal(data));
    this.started = new Promise<void>((resolve, reject) => { this.settleStart = error => error === undefined ? resolve() : reject(error instanceof Error ? error : new Error(message(error))); });
    this.started.catch(() => undefined);
  }
  /** Callers waiting for the current or next index to finish. */
  private indexWaiters: { resolve: () => void; reject: (error: Error) => void }[] = [];
  /**
   * Wait until notes are indexed. Call before entering the mutation queue: indexing
   * itself queues work, so waiting inside the queue would never finish.
   */
  private async whenIndexed(): Promise<void> {
    await this.whenStarted();
    if (this.indexed) return;
    // A failed index is not retried by itself: answer now instead of waiting for ever.
    if (!this.indexing && this.issues.has('index')) throw new Error('The planner could not finish reading your notes, so this was not saved. Choose Rebuild index, then try again.');
    await new Promise<void>((resolve, reject) => this.indexWaiters.push({ resolve, reject }));
  }
  private async whenStarted(): Promise<void> {
    if (this.initialized) return;
    try { await this.started; }
    catch (error) { throw new Error(`The planner could not start (${message(error)}). Nothing was saved; reload Obsidian and try again.`); }
  }
  private async emojiText(): Promise<string> {
    const saved = dataRecord(await this.plugin.loadData());
    return JSON.stringify(normalizedEmojis(saved?.projectEmojis ?? this.settings.projectEmojis));
  }
  private async emojiChange(emojis: ProjectEmojis): Promise<Change> {
    const base = await this.emojiText();
    if (base !== JSON.stringify(normalizedEmojis(this.settings.projectEmojis))) throw new Conflict('Project emojis changed outside the plugin. Reload before retrying.');
    return { path: EMOJI_PATH, base, patches: minimalDiff(base, JSON.stringify(normalizedEmojis(emojis))), label: 'Update project emojis' };
  }
  private assignedEmojis(codes = this.settings.projectCodes): ProjectEmojis {
    const summaries = this.summarySources().sort((a, b) => Number(b.path === this.settings.summaryPath) - Number(a.path === this.settings.summaryPath) || (b.start ?? '').localeCompare(a.start ?? '') || a.path.localeCompare(b.path));
    // Zero-only footers retain local recognition without registering a project globally.
    const visible = normalizedCodes([...codes, ...Object.keys(this.settings.projectEmojis), ...[...this.days.values()].flatMap(day => Object.keys(day.recorded))]);
    return assignProjectEmojis(visible, this.settings.projectEmojis, summaries);
  }
  emojiConflicts(): EmojiConflict[] { return this.summarySources().flatMap(s => summaryEmojiChanges(s, this.settings.projectEmojis).conflicts); }
  private async emojiSummaryChanges(emojis: ProjectEmojis, force = new Set<string>()): Promise<Change[]> {
    const changes: Change[] = [];
    for (const cached of this.summarySources()) {
      const raw = await this.port.read(cached.path);
      if (raw !== cached.text) throw new Conflict(`${cached.path} changed. Refresh before changing project emojis.`);
      const update = summaryEmojiChanges(cached, emojis, force);
      if (update.issues.length) throw new Error(update.issues.join(' '));
      if (update.patches.length) changes.push({ path: cached.path, base: raw, patches: update.patches, label: 'Update summary emojis' });
    }
    return changes;
  }
  async setProjectEmoji(input: string, value: string): Promise<void> {
    await this.enqueue(async () => {
      if (this.pendingProjectWrite) throw new Error('An earlier project change stopped partway. Finish it first: choose Finish interrupted edits.');
      const code = projectCode(input);
      if (!this.settings.projectCodes.includes(code)) throw new Error('Register this project first.');
      await this.refreshSummaries();
      const emojis = { ...this.settings.projectEmojis, [code]: value.trim() ? projectEmoji(value) : randomProjectEmoji() };
      const changes = [...await this.emojiSummaryChanges(emojis, new Set([code])), await this.emojiChange(emojis)];
      try {
        const guards = [...this.summarySources().map(s => ({ path: s.path, text: s.text })),
          { path: EMOJI_PATH, text: changes.at(-1)!.base }, { path: REGISTRY_PATH, text: await this.registryText() }];
        const op = await this.journal.perform(changes, `Change ${code} emoji`, false, guards);
        await this.refreshOperation(op);
      } catch (error) { this.syncRecoveryIssue(); this.emit(); throw error; }
      this.emit(); this.scheduleCache();
    });
  }
  async resolveEmojiConflict(conflict: EmojiConflict, adopt: boolean): Promise<void> {
    if (!this.emojiConflicts().some(c => JSON.stringify(c) === JSON.stringify(conflict))) throw new Conflict('The emoji conflict changed. Refresh and try again.');
    await this.setProjectEmoji(conflict.code, adopt ? conflict.emoji : conflict.assigned);
  }
  private async registryText(): Promise<string> {
    const saved = dataRecord(await this.plugin.loadData());
    return JSON.stringify({ projectCodes: normalizedCodes(stringItems(saved.projectCodes ?? this.settings.projectCodes)), projectGroups: normalizeGroups(saved?.projectGroups ?? this.settings.projectGroups) });
  }
  private async registryChange(codes: string[], groups = this.settings.projectGroups): Promise<Change> {
    const base = await this.registryText();
    const after = JSON.stringify({ projectCodes: normalizedCodes(codes), projectGroups: normalizeGroups(groups) });
    return { path: REGISTRY_PATH, base, patches: minimalDiff(base, after), label: 'Update project registry' };
  }
  /** The project codes the indexed days were last parsed with. */
  private parsedWith = '';
  private codesKey(codes: string[]): string { return [...codes].sort().join(','); }
  /** Parse every day again, only when the registered codes differ from the ones they were parsed with. */
  private reparseDays(): void {
    const key = this.codesKey(this.settings.projectCodes);
    if (key === this.parsedWith) return;
    for (const [path, day] of this.days) this.days.set(path, parseDay(day.text, path, this.settings.projectCodes));
    this.parsedWith = key;
  }
  private async refreshOperation(operation: Operation | null): Promise<void> {
    for (const write of operation?.writes ?? []) {
      if ([REGISTRY_PATH, EMOJI_PATH, PROJECT_SOURCES_PATH].includes(write.path)) continue;
      const raw = await this.port.read(write.path);
      if (raw === null) this.remove(write.path); else this.ingest(write.path, raw);
    }
    this.reparseDays();
  }
  recordBests(summary: Summary): Map<string, number | null> {
    return summaryBests(summary, this.days.values(), this.summarySources());
  }
  private summarySources(): Summary[] { return [...this.summaries.values()].filter(s => s.path === this.settings.summaryPath || isSummaryPath(s.path)); }
  private get pendingProjectWrite(): boolean {
    return this.journal.data.operations.some(o => (o.state === 'pending' || o.state === 'interrupted') && o.writes.some(w => (w.path === REGISTRY_PATH || w.path === EMOJI_PATH)));
  }
  /**
   * Re-read summaries whose note differs from the indexed copy. A summary edited elsewhere
   * (another editor, a sync tool) may not have reached the index yet; emoji and project
   * changes must start from its current text rather than refuse every action until restart.
   */
  private async refreshSummaries(): Promise<void> {
    for (const summary of this.summarySources()) {
      const raw = await this.port.read(summary.path);
      if (raw === null) this.remove(summary.path); else if (raw !== summary.text) this.ingest(summary.path, raw);
    }
  }
  private async synchronizeProjects(dates?: Set<string>, definitions = false, operation: Operation | null = null): Promise<void> {
    if (this.pendingProjectWrite) { this.issues.set('projects', 'An earlier project change stopped partway, so new project codes are not added yet. Choose Finish interrupted edits.'); return; }
    await this.refreshSummaries();
    const documents = [...this.days.values(), ...this.summarySources()].map(s => ({ path: s.path, text: s.text }));
    // Codes come from the already parsed index; days are parsed again only for a new code set.
    const codes = codesFromParsed(this.days.values(), this.summarySources(), this.settings.projectCodes);
    const days = this.codesKey(codes) === this.parsedWith ? [...this.days.values()]
      : [...this.days.values()].map(day => parseDay(day.text, day.path, codes));
    const emojis = this.assignedEmojis(codes);
    const missing = missingProjectChanges(days, this.summarySources(), this.now().date, dates, emojis);
    const registry = await this.registryChange(codes);
    const emoji = await this.emojiChange(emojis);
    const definitionsChanges = definitions ? [...missing.changes] : [];
    if (definitions) {
      for (const change of await this.emojiSummaryChanges(emojis)) {
        const prior = definitionsChanges.find(c => c.path === change.path);
        if (prior) {
          const intermediate = applyPatches(prior.base, prior.patches);
          prior.patches = minimalDiff(prior.base, applyPatches(intermediate, summaryEmojiChanges(parseSummary(intermediate, prior.path), emojis).patches));
        } else definitionsChanges.push(change);
      }
    }
    const changes = [...definitionsChanges, ...(registry.patches.length ? [registry] : []), ...(emoji.patches.length ? [emoji] : [])];
    if (changes.length) {
      try {
        if (operation) { for (const change of changes) await this.journal.append(operation, change, documents); await this.refreshOperation(operation); }
        else { const op = await this.journal.perform(changes, 'Register projects', false, documents); await this.refreshOperation(op); }
      }
      catch (error) { this.reparseDays(); this.syncRecoveryIssue(); throw error; }
    } else this.reparseDays();
    const pending = [...missing.issues, ...(!definitions && missing.changes.length ? ['Some positive daily project codes are missing from their period summaries. Use sync summaries in Projects settings.'] : [])];
    if (pending.length) this.issues.set('projects', groupDays(pending).join(' ')); else this.issues.delete('projects');
  }
  async syncProjectRegistrations(): Promise<void> { await this.enqueue(() => this.synchronizeProjects(undefined, true)); this.emit(); this.scheduleCache(); }
  now() { return localNow(new Date(), this.settings.timezone); }
  onChange(fn: (projectChange?: { from: string; to: string }) => void): () => void { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  private streakCache?: { date: string; value: HotStreak };
  /** Cleared on source/setting notifications, not on row selection or view filters. */
  streak(): HotStreak {
    if (!this.indexed || this.indexing) return { available: false, reason: 'Loading planner history.' };
    const date = this.now().date;
    if (this.streakCache?.date === date) return this.streakCache.value;
    const value = hotStreak(recordedReviewRows(this.days.values(), [...this.summaries.values()]), date, this.criteria());
    this.streakCache = { date, value };
    return value;
  }
  private recordsCache?: Map<string, DayRecord>;
  /** Best single-day credit per registered project and overall, across all history; read-only. */
  records(): Map<string, DayRecord> {
    if (!this.indexed || this.indexing) return new Map();
    this.recordsCache ??= dayRecords(recordedReviewRows(this.days.values(), [...this.summaries.values()]), this.projectCodes());
    return this.recordsCache;
  }
  emit(projectChange?: { from: string; to: string }): void { this.streakCache = undefined; this.recordsCache = undefined; for (const fn of this.listeners) fn(projectChange); }
  private async readJson(name: string): Promise<unknown> {
    try { return JSON.parse(await this.app.vault.adapter.read(`${this.config}/${name}`)); } catch { return null; }
  }
  private persistJournal(data: JournalData): Promise<void> {
    // Alternating complete snapshots retain a valid previous journal if a write is interrupted.
    const snapshot = JSON.stringify(data), sequence = ++this.recoverySequence;
    const envelope = JSON.stringify({ sequence, snapshot, checksum: checksum(snapshot) });
    const result = this.jsonQueue.then(() => this.app.vault.adapter.write(`${this.config}/recovery-${sequence % 2}.json`, envelope));
    this.jsonQueue = result.catch(() => undefined);
    return result;
  }
  async initialize(): Promise<void> {
    try { await this.load(); this.settleStart(); }
    catch (error) { this.settleStart(error); throw error; }
  }
  private async load(): Promise<void> {
    const loaded = dataRecord(await this.plugin.loadData());
    this.settings = { ...DEFAULTS, ...loaded, projectCodes: stringItems(loaded.projectCodes) };
    try { localNow(new Date(), this.settings.timezone); } catch { this.settings.timezone = systemTimeZone(); }
    // 0.2.135-0.2.138 kept a prefix and a suffix separately; one choice replaces them.
    this.settings.dailyName = normalizeDailyName(loaded.dailyName, loaded.dailyPrefix, loaded.dailySuffix);
    this.settings.dailyNamesUsed = (Array.isArray(loaded.dailyNamesUsed) ? loaded.dailyNamesUsed : []).map(name => normalizeDailyName(name)).filter(name => name.kind !== 'date');
    delete (this.settings as Partial<Settings> & { dailyPrefix?: unknown; dailySuffix?: unknown }).dailyPrefix;
    delete (this.settings as Partial<Settings> & { dailyPrefix?: unknown; dailySuffix?: unknown }).dailySuffix;
    this.applyDailyName();
    Object.assign(this.settings, normalizeEntryDefaults(this.settings));
    this.settings.projectEmojis = normalizedEmojis(this.settings.projectEmojis);
    this.settings.projectGroups = normalizeGroups(this.settings.projectGroups);
    this.settings.weekendDays = normalizeWeekends(this.settings.weekendDays);
    // Criteria now come from thejaz-criteria.md; the old marker source setting is dropped.
    delete (this.settings as Partial<Settings> & { markerSourcePath?: unknown }).markerSourcePath;
    if (typeof this.settings.showMarkerCounts !== 'boolean') this.settings.showMarkerCounts = true;
    // Rounding was retired in 0.2.139; its saved switches are dropped on the next save.
    delete (this.settings as Partial<Settings> & { roundTimes?: unknown; roundCredits?: unknown }).roundTimes;
    delete (this.settings as Partial<Settings> & { roundTimes?: unknown; roundCredits?: unknown }).roundCredits;
    this.settings.activityHelpers = upgradedHelpers(this.settings.activityHelpers, loaded.activityHelperDefaultsVersion === 1);
    this.settings.activityHelperDefaultsVersion = 1;
    this.settings.ignoredChecks = stringItems(loaded.ignoredChecks);
    const copies = await Promise.all(RECOVERY_FILES.map(name => this.readJson(name)));
    const valid = copies.filter((v): v is { sequence: number; snapshot: string; checksum: number } => {
      const x = v as { sequence?: number; snapshot?: string; checksum?: number } | null;
      return !!x && Number.isFinite(x.sequence) && typeof x.snapshot === 'string' && x.checksum === checksum(x.snapshot);
    }).sort((a, b) => b.sequence - a.sequence);
    if (valid[0]) { this.recoverySequence = valid[0].sequence; await this.journal.load(JSON.parse(valid[0].snapshot)); }
    else { await this.journal.load(null); await this.setAsideUnreadableRecovery(); }
    this.syncRecoveryIssue();
    this.initialized = true;
  }
  /**
   * Recovery files exist but none can be read (0.3.13). Starting with empty history keeps the
   * notes safe, but say so, and copy the unreadable files aside before new history replaces them.
   * Only once both are copied is a fresh snapshot written, so the next start is quiet; if a copy
   * fails, the files are left for a restart to try again.
   */
  private async setAsideUnreadableRecovery(): Promise<void> {
    const adapter = this.app.vault.adapter, present: string[] = [];
    for (const name of RECOVERY_FILES) if (await adapter.exists(`${this.config}/${name}`)) present.push(name);
    if (!present.length) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    let kept = true;
    for (const name of present) {
      try { await adapter.copy(`${this.config}/${name}`, `${this.config}/${name.replace('recovery-', `recovery-unreadable-${stamp}-`)}`); }
      catch { kept = false; }
    }
    if (kept) try { await this.persistJournal(this.journal.data); } catch { /* The next edit writes it. */ }
    const lost = 'The planner\'s recovery history could not be read, so an edit interrupted before Obsidian started cannot be finished or undone here. Your notes are unchanged.';
    this.issues.set(RECOVERY_HISTORY, kept
      ? `${lost} New edits are protected as usual, and the unreadable files were kept in the plugin folder as recovery-unreadable files. Choose Dismiss.`
      : `${lost} The files were left as they are; restart Obsidian before making changes to try reading them again.`);
  }
  /** Hides the unreadable-recovery message; it explains, and has nothing left to fix. */
  dismissRecoveryNotice(): void { if (this.issues.delete(RECOVERY_HISTORY)) this.emit(); }
  async saveSettings(): Promise<void> { await this.plugin.saveData(this.settings); }
  /** Settings tab edits share the mutation queue so project recovery never merges a half-applied value. */
  async updateSettings(changes: GeneralSettings): Promise<void> {
    await this.whenStarted(); // Settings load first, so a change made at startup is neither lost nor saves over them.
    await this.enqueue(async () => {
      const keys = Object.keys(changes) as (keyof GeneralSettings)[];
      const previous = Object.fromEntries(keys.map(key => [key, this.settings[key]])) as GeneralSettings, previousUsed = this.settings.dailyNamesUsed;
      const rescan = keys.some(key => (key === 'summaryPath' || key === 'routinesFolder') && changes[key] !== this.settings[key])
        || (!!changes.dailyName && JSON.stringify(changes.dailyName) !== JSON.stringify(this.settings.dailyName));
      if (changes.dailyName) {
        const { prefix, suffix } = dailyNameAffixes(changes.dailyName), problem = dailyAffixProblem(prefix, suffix);
        if (problem) throw new Error(`${problem} The last saved name is still in use.`);
        if (changes.dailyName.kind !== 'date' && !changes.dailyName.text) changes = { ...changes, dailyName: DATE_ONLY };
        // The name being left keeps being read, so days made under it still count.
        const leaving = this.settings.dailyName, next = changes.dailyName;
        if (leaving.kind !== 'date' && JSON.stringify(leaving) !== JSON.stringify(next) && await this.dailyNameInUse(leaving)) {
          const used = [...this.settings.dailyNamesUsed, leaving].filter(name => JSON.stringify(name) !== JSON.stringify(next));
          this.settings.dailyNamesUsed = used.filter((name, i) => used.findIndex(other => JSON.stringify(other) === JSON.stringify(name)) === i);
        }
      }
      Object.assign(this.settings, changes);
      try { await this.saveSettings(); } catch (error) { Object.assign(this.settings, previous); this.settings.dailyNamesUsed = previousUsed; throw error; }
      // Names decide which notes are planner days: read the vault again with the new ones.
      this.applyDailyName();
      if (rescan) this.scheduleReindex();
    });
    this.emit();
  }
  /** Read matching files directly because startup or a settings rescan may still be in progress. */
  private async dailyNameInUse(name: DailyName): Promise<boolean> {
    const { prefix, suffix } = dailyNameAffixes(name);
    for (const file of this.app.vault.getMarkdownFiles()) {
      const date = dateFromPath(file.name);
      if (date && file.name === `${prefix}${date}${suffix}.md` && !isRoutine(file.path, this.settings.routinesFolder)
        && isPlannerDay(await this.app.vault.cachedRead(file))) return true;
    }
    return false;
  }
  private applyDailyName(): void {
    const { prefix, suffix } = dailyNameAffixes(this.settings.dailyName);
    setDailyNameAffixes(prefix, suffix, this.settings.dailyNamesUsed.map(dailyNameAffixes));
  }
  private scheduleReindex(): void {
    if (!this.alive) return;
    window.clearTimeout(this.reindexTimer);
    this.reindexTimer = window.setTimeout(() => void this.index(), 800);
  }
  /** Note checks currently ignored. */
  ignoredChecks(): ReadonlySet<string> { return new Set(this.settings.ignoredChecks); }
  /** How many ignored checks still hide a warning; ignores whose row was edited no longer count. */
  activeIgnoredCount(): number { return this.indexed ? activeIgnores(this.days.values(), this.ignoredChecks()).size : this.settings.ignoredChecks.length; }
  /** Hide these note checks; nothing in the notes changes. */
  async ignoreChecks(keys: string[]): Promise<void> {
    await this.whenStarted(); // Settings load first, so a change made at startup is neither lost nor saves over them.
    await this.enqueue(async () => {
      const previous = this.settings.ignoredChecks;
      // Lapsed ignores (their rows were edited) are dropped as new ones are added.
      const kept = this.indexed ? [...activeIgnores(this.days.values(), new Set(previous))] : previous;
      this.settings.ignoredChecks = [...new Set([...kept, ...keys])];
      try { await this.saveSettings(); } catch (error) { this.settings.ignoredChecks = previous; throw error; }
    });
    this.emit();
  }
  /** Show every ignored note check again. */
  async restoreIgnoredChecks(): Promise<void> {
    await this.whenStarted(); // Settings load first, so a change made at startup is neither lost nor saves over them.
    await this.enqueue(async () => {
      const previous = this.settings.ignoredChecks;
      this.settings.ignoredChecks = [];
      try { await this.saveSettings(); } catch (error) { this.settings.ignoredChecks = previous; throw error; }
    });
    this.emit();
  }
  async setReviewPreferences(updates: ReviewPreferences | ((settings: Settings) => ReviewPreferences)): Promise<void> {
    await this.whenStarted(); // Settings load first, so a change made at startup is neither lost nor saves over them.
    await this.enqueue(async () => {
      const next = { ...this.settings, ...(typeof updates === 'function' ? updates(this.settings) : updates) };
      next.projectGroups = normalizeGroups(next.projectGroups);
      next.weekendDays = normalizeWeekends(next.weekendDays);
      await this.plugin.saveData(next);
      Object.assign(this.settings, next);
      for (const [path, summary] of this.summaries) this.summaries.set(path, { ...summary, weekends: [...next.weekendDays] });
      this.emit();
    });
  }
  /** New on its day while no earlier date uses it; nothing is new while indexing is incomplete. */
  isFirstActivity(name: string, date?: string | null): boolean {
    if (!this.indexed || this.indexing) return false;
    return date ? this.days.occurrences.isNewOn(name, date) : this.days.occurrences.isFirst(name);
  }
  /** Activity helpers for a day: the configured names, then project codes. */
  helpersFor(day: Day | null): string[] { return activityHelpers(this.settings.activityHelpers, this.codesFor(day)); }
  codesFor(day: Day | null): string[] {
    return [...new Set([...this.settings.projectCodes.map(code => code.toUpperCase()), ...Object.keys(day?.recorded ?? {})])];
  }
  async setEntryDefaults(value: EntryDefaults): Promise<void> {
    await this.whenStarted(); // Settings load first, so a change made at startup is neither lost nor saves over them.
    validateEntryDefaults(value);
    await this.enqueue(async () => {
      const previous = normalizeEntryDefaults(this.settings);
      Object.assign(this.settings, value);
      try { await this.saveSettings(); } catch (error) { Object.assign(this.settings, previous); throw error; }
    });
    this.emit();
  }
  private async updateProjectCodes(codes: string[]): Promise<void> {
    const op = await this.journal.perform([await this.registryChange(codes)], 'Update project registry');
    await this.refreshOperation(op);
    // Reinterpret cached source, without repairing or rewriting any note.
    for (const [path, day] of this.days) this.days.set(path, parseDay(day.text, path, this.settings.projectCodes));
    await this.checkSummaryStatus(); this.emit(); this.scheduleCache();
  }
  async setProjectCodes(codes: string[]): Promise<void> {
    const next = normalizedCodes(codes);
    if (this.settings.projectCodes.some(code => !next.includes(code))) throw new Error('Use the project remove action to preview attribution or record removal.');
    for (const code of next) if (!this.settings.projectCodes.includes(code)) await this.createProject(code);
  }
  async addProjectCode(code: string, emoji?: string): Promise<void> {
    await this.createProject(code, emoji);
  }
  projectCodes(): string[] {
    return normalizedCodes(this.settings.projectCodes).sort();
  }
  private transferFiles(): { path: string; kind: ProjectDocument['kind'] }[] {
    return this.app.vault.getMarkdownFiles().flatMap(file => {
      const kind: ProjectDocument['kind'] | null = this.isTemplate(file.path) ? 'template' : this.days.has(file.path) ? 'day' : file.path === this.settings.summaryPath || isSummaryPath(file.path) ? 'summary' : null;
      return kind ? [{ path: file.path, kind }] : [];
    }).sort((a, b) => a.path.localeCompare(b.path));
  }
  private transferScopeText(): string { return JSON.stringify({ summaryPath: this.settings.summaryPath, routinesFolder: this.settings.routinesFolder, files: this.transferFiles() }); }
  private checkTransferScope(operation: Operation | null): void {
    const checkpoint = operation?.writes.find(w => w.path === PROJECT_SOURCES_PATH);
    if (checkpoint && checkpoint.after !== this.transferScopeText()) throw new Conflict('Notes or templates were added, removed, or renamed since this project change. Put them back before finishing or undoing it.');
  }
  private transferTransition(operation: Operation | null, undo = false): { from: string; to: string } | undefined {
    let label = operation?.label ?? '';
    while (/^(Undo|Redo): /.test(label)) { if (label.startsWith('Undo: ')) undo = !undo; label = label.replace(/^(Undo|Redo): /, ''); }
    const match = /^(Rename|Merge) project ([A-Z][A-Z0-9]*) (?:to|into) ([A-Z][A-Z0-9]*)$/.exec(label);
    return match && (!undo || match[1] === 'Rename') ? { from: match[undo ? 3 : 2]!, to: match[undo ? 2 : 3]! } : undefined;
  }
  async previewProjectTransfer(source: string, target: string, mode: ProjectTransferMode): Promise<ProjectTransferPreview> {
    await this.whenIndexed();
    return this.enqueue(async () => {
      if (!this.initialized || !this.indexed) throw new Error('The planner is still starting up, so this was not saved. Try again in a few seconds.');
      if (this.pendingProjectWrite) throw new Error('An earlier project change stopped partway. Finish it first: choose Finish interrupted edits.');
      const registry = await this.registryText(), emojis = await this.emojiText(), scope = this.transferScopeText();
      const savedRegistry = JSON.stringify({ projectCodes: normalizedCodes(this.settings.projectCodes), projectGroups: normalizeGroups(this.settings.projectGroups) });
      if (registry !== savedRegistry || emojis !== JSON.stringify(normalizedEmojis(this.settings.projectEmojis)))
        throw new Conflict('Project settings changed outside the plugin. Reload before previewing.');
      const documents: ProjectDocument[] = [];
      for (const file of this.transferFiles()) {
        const text = await this.port.read(file.path);
        if (text === null) throw new Conflict(`${file.path} disappeared. Refresh and preview again.`);
        documents.push({ ...file, text });
      }
      if (scope !== this.transferScopeText()) throw new Conflict('The note or template list changed while preparing the preview. Preview again.');
      return { ...transferProject(documents, source, target, mode, this.settings), registry, emojis, scope, summaryPath: this.settings.summaryPath, routinesFolder: this.settings.routinesFolder };
    });
  }
  async applyProjectTransfer(plan: ProjectTransferPreview): Promise<void> {
    await this.enqueue(async () => {
      if (this.pendingProjectWrite) throw new Error('An earlier project change stopped partway. Finish it first: choose Finish interrupted edits.');
      if (plan.blockers.length) throw new Error('Correct the listed sources, then preview again.');
      if (plan.source === plan.target) return;
      if (this.settings.summaryPath !== plan.summaryPath || this.settings.routinesFolder !== plan.routinesFolder
        || await this.registryText() !== plan.registry || await this.emojiText() !== plan.emojis)
        throw new Conflict('Project settings changed since the preview. Preview again.');
      if (JSON.stringify(this.transferFiles()) !== JSON.stringify(plan.sources.map(({ path, kind }) => ({ path, kind })))) throw new Conflict('The note or template list changed since the preview. Preview again.');
      for (const doc of plan.sources) if (await this.port.read(doc.path) !== doc.text) throw new Conflict(`${doc.path} changed since the preview. Preview again.`);
      // Derive the operation again from the guarded sources rather than trusting UI patches.
      const fresh = transferProject(plan.sources, plan.source, plan.target, plan.mode, plan.before);
      if (fresh.blockers.length || JSON.stringify(fresh.changes) !== JSON.stringify(plan.changes) || JSON.stringify(fresh.after) !== JSON.stringify(plan.after)) throw new Conflict('The preview changed. Generate it again before applying.');
      const registry = await this.registryChange(fresh.after.projectCodes, fresh.after.projectGroups), emoji = await this.emojiChange(fresh.after.projectEmojis);
      const label = `${plan.mode === 'rename' ? 'Rename' : 'Merge'} project ${plan.source} ${plan.mode === 'rename' ? 'to' : 'into'} ${plan.target}`;
      const guards = [...plan.sources, { path: REGISTRY_PATH, text: plan.registry }, { path: EMOJI_PATH, text: plan.emojis }, { path: PROJECT_SOURCES_PATH, text: plan.scope }];
      try {
        const op = await this.journal.perform([...fresh.changes, registry, emoji], label, false, guards);
        await this.refreshOperation(op);
      } catch (error) {
        for (const change of fresh.changes) { const raw = await this.port.read(change.path); if (raw !== null) this.ingest(change.path, raw); }
        this.reparseDays(); this.syncRecoveryIssue(); this.emit(); throw error;
      }
      await this.checkSummaryStatus(); this.emit({ from: plan.source, to: plan.target }); this.scheduleCache();
    });
  }
  async previewProjectRemoval(code: string, mode: 'unlink' | 'delete'): Promise<ProjectRemoval> {
    return this.enqueue(async () => {
      const documents: { path: string; text: string }[] = [];
      for (const file of this.app.vault.getMarkdownFiles()) {
        // Only indexed planner days: a note named like a day but holding no plan is not the planner's.
        if (this.isTemplate(file.path) || (!this.days.has(file.path) && file.path !== this.settings.summaryPath && !isSummaryPath(file.path))) continue;
        const text = await this.port.read(file.path);
        if (text !== null) documents.push({ path: file.path, text });
      }
      return removeProject(documents, code, mode, this.settings.projectCodes, this.settings.weekendDays, this.criteria());
    });
  }
  async applyProjectRemoval(plan: ProjectRemoval): Promise<void> {
    await this.enqueue(async () => {
      if (this.pendingProjectWrite) throw new Error('An earlier project change stopped partway. Finish it first: choose Finish interrupted edits.');
      if (plan.blockers.length) throw new Error('Resolve the listed records, then preview again.');
      // Bulk previews must still match every source exactly. Do not rebase this operation.
      const paths = this.app.vault.getMarkdownFiles().filter(file => !this.isTemplate(file.path) && (this.days.has(file.path) || file.path === this.settings.summaryPath || isSummaryPath(file.path))).map(file => file.path).sort();
      if (JSON.stringify(paths) !== JSON.stringify(plan.sources.map(source => source.path).sort())) throw new Conflict('The record list changed since the preview. Preview again before applying.');
      for (const source of plan.sources) if (await this.port.read(source.path) !== source.text)
        throw new Conflict(`${source.path} changed since the preview. Preview again before applying.`);
      const registry = await this.registryChange(this.settings.projectCodes.filter(code => code !== plan.code), this.settings.projectGroups.map(g => ({ ...g, projects: g.projects.filter(code => code !== plan.code) })));
      const emojis = { ...this.settings.projectEmojis }; delete emojis[plan.code];
      try { await this.journal.perform([...plan.changes, registry, await this.emojiChange(emojis)], `${plan.mode === 'unlink' ? 'Unlink' : 'Delete'} ${plan.code} project`, false, plan.sources); }
      catch (error) {
        for (const change of plan.changes) { const saved = await this.port.read(change.path); if (saved !== null) this.ingest(change.path, saved); }
        this.syncRecoveryIssue(); this.emit(); throw error;
      }
      for (const change of plan.changes) {
        const saved = await this.port.read(change.path); if (saved !== null) this.ingest(change.path, saved);
      }
      this.reparseDays(); await this.checkSummaryStatus(); this.emit(); this.scheduleCache();
    });
  }
  async createProject(input: string, emoji?: string, dayPath?: string): Promise<void> {
    await this.whenIndexed();
    await this.enqueue(async () => {
      if (this.pendingProjectWrite) throw new Error('An earlier project change stopped partway. Finish it first: choose Finish interrupted edits.');
      if (!this.initialized || !this.indexed) throw new Error('The planner is still starting up, so this was not saved. Try again in a few seconds.');
      const code = projectCode(input), path = this.settings.summaryPath;
      const assigned = emoji?.trim() ? projectEmoji(emoji) : this.settings.projectEmojis[code] ?? randomProjectEmoji();
      const emojis = { ...this.settings.projectEmojis, [code]: assigned };
      const raw = await this.port.read(path);
      if (raw === null) throw new Error('The summary note was not found. Set its location in Planner settings, under Summary note, then try again.');
      const summary = this.summaryOf(raw, path), codes = [...this.settings.projectCodes, code];
      // Use known recorded/explicit credit only; adding a definition never reconciles other totals.
      let value = 0;
      const today = this.now().date;
      value = projectValue([...this.days.values()].map(day => parseDay(day.text, day.path, codes)), summary, code, today);
      const changes: Change[] = [{ path, base: raw, patches: newProjectPatch(summary, code, assigned, value), label: `Add ${code} project` }];
      if (dayPath) {
        const text = await this.port.read(dayPath);
        if (text === null) throw new Error('The selected day is no longer available. Refresh and try again.');
        const day = parseDay(text, dayPath, codes);
        if (day.recordedOnly) throw new Error('Add project totals directly in this recorded totals note.');
        if (day.legacy) throw new Error('Open a current-format day to add a project. Historical notes remain unchanged.');
        if (day.recorded[code] === undefined) {
          const sum = day.footers.find(footer => footer.code === 'SUM');
          const at = sum ? day.lines[sum.line]!.start : text.length;
          const total = calculate(day).projects[code] ?? 0;
          changes.push({ path: dayPath, base: text, label: `Add ${code} project`, patches: [patch(text, at, at,
            (at > 0 && !/[\r\n]/.test(text[at - 1]!) ? day.eol : '') + totalLine(code, total) + day.eol)] });
        }
      }
      for (const change of await this.emojiSummaryChanges(emojis, emoji?.trim() ? new Set([code]) : new Set())) {
        const prior = changes.find(c => c.path === change.path);
        if (prior) {
          const interim = applyPatches(prior.base, prior.patches);
          prior.patches = minimalDiff(prior.base, applyPatches(interim, summaryEmojiChanges(parseSummary(interim, prior.path), emojis, emoji?.trim() ? new Set([code]) : new Set()).patches));
        } else changes.push(change);
      }
      changes.push(await this.registryChange(codes), await this.emojiChange(emojis));
      try { await this.journal.perform(changes, `Add ${code} project`, false, [...this.days.values()].map(d => ({ path: d.path, text: d.text })).concat({ path, text: raw })); }
      catch (error) {
        for (const change of changes) if (change.path !== REGISTRY_PATH && change.path !== EMOJI_PATH) { const raw = await this.port.read(change.path); if (raw !== null) this.ingest(change.path, raw); }
        this.reparseDays(); this.syncRecoveryIssue(); this.emit();
        throw new Error(`Adding the project stopped partway; your notes are safe. Choose Finish interrupted edits. (${message(error)})`);
      }
      for (const change of changes) {
        if (change.path === REGISTRY_PATH || change.path === EMOJI_PATH) continue;
        const saved = await this.port.read(change.path);
        if (saved !== null) this.ingest(change.path, saved);
      }
      this.reparseDays(); this.emit(); this.scheduleCache();
    });
  }
  async index(): Promise<void> {
    if (this.indexing) { this.reindexRequested = true; return; }
    this.indexing = true; this.reindexRequested = false;
    try {
      const cache = await this.readJson('index.json') as { version?: number; files?: Record<string, { mtime: number; size: number; text: string }> } | null;
      // The file on disk may be missing or damaged; write it once after every full index.
      this.savedCacheRevision = '';
      const markdownFiles = this.app.vault.getMarkdownFiles();
      await this.enqueue(async () => {
        if (this.app.vault.getAbstractFileByPath(this.settings.summaryPath) instanceof TFile) return;
        const current = markdownFiles.filter(file => file.name.toLowerCase() === 'thejaz-summary-now.md');
        if (current.length !== 1) return;
        this.settings.summaryPath = current[0]!.path;
        await this.saveSettings();
      });
      // Summary-named routines-folder files are read so ingest can tell dated summaries from templates.
      const files = markdownFiles.filter(f => (!isRoutine(f.path, this.settings.routinesFolder) || isSummaryPath(f.path))
        && (dateFromPath(f.path) || f.path === this.settings.summaryPath || isSummaryPath(f.path) || isCriteriaPath(f.path)));
      const present = new Set(files.map(f => f.path));
      for (const path of this.days.keys()) if (!present.has(path)) this.days.delete(path);
      for (const path of this.summaries.keys()) if (!present.has(path)) this.summaries.delete(path);
      for (const path of this.criteriaNotes.keys()) if (!present.has(path)) this.criteriaNotes.delete(path);
      for (const path of this.routineSummaries) if (!present.has(path)) this.routineSummaries.delete(path);
      // Today's note first. Work out the date once: time-zone formatting per comparison cost seconds on large vaults.
      const today = this.now().date;
      files.sort((a, b) => Number(b.basename === today) - Number(a.basename === today));
      let start = performance.now(), progress = -Infinity;
      const run = { started: start, finished: 0, cached: 0, read: 0 };
      const parsing = this.codesKey(this.settings.projectCodes);
      for (const file of files) {
        if (!this.alive) return;
        const saved = cache?.version === 2 ? cache.files?.[file.path] : undefined;
        const hit = !!saved && saved.mtime === file.stat.mtime && saved.size === file.stat.size && typeof saved.text === 'string';
        if (hit) this.cacheVerified.set(file.path, saved);
        const raw = hit ? saved.text : await this.app.vault.cachedRead(file);
        if (hit) run.cached++; else run.read++;
        this.ingest(file.path, raw);
        const elapsed = performance.now() - start;
        if (elapsed >= INDEX_SLICE_MS) {
          this.performance.indexSlices.push(elapsed);
          // The first slice holds today's note, so the view shows it straight away.
          if (performance.now() - progress >= INDEX_PROGRESS_MS) { this.emit(); progress = performance.now(); }
          await new Promise(resolve => window.setTimeout(resolve, 0));
          start = performance.now();
        }
      }
      run.finished = performance.now(); this.performance.indexRuns.push(run);
      // Every day was just parsed with these codes, unless they changed while indexing.
      if (this.codesKey(this.settings.projectCodes) === parsing) this.parsedWith = parsing;
      this.routinePaths.clear();
      for (const file of this.app.vault.getMarkdownFiles().filter(f => isRoutine(f.path, this.settings.routinesFolder) && !f.path.includes('/_archive/'))) {
        const text = await this.app.vault.cachedRead(file);
        if (/^##\s+plan for\b/im.test(text) || /^###\s+(morning|afternoon|evening)\s*$/im.test(text)) this.routinePaths.add(file.path);
      }
      await this.enqueue(() => this.synchronizeProjects());
      this.indexed = true; this.issues.delete('index');
      for (const waiter of this.indexWaiters.splice(0)) waiter.resolve();
      if (this.deferredSummaries.size) await this.enqueue(() => this.finishDeferredSummaries());
      await this.enqueue(() => this.checkSummaryStatus());
      this.scheduleCache();
    } catch (error) {
      this.issues.set('index', `The planner stopped reading your notes (${message(error)}). Your notes are unchanged. Choose Rebuild index to try again.`);
      for (const waiter of this.indexWaiters.splice(0)) waiter.reject(new Error(`The planner could not finish reading your notes (${message(error)}), so this was not saved. Choose Rebuild index, then try again.`));
    }
    finally {
      this.indexing = false; this.emit();
      // A settings change during indexing needs a scan with the new paths.
      if (this.reindexRequested && this.alive) void this.index();
    }
  }
  ingest(path: string, raw: string): void {
    this.streakCache = undefined; this.recordsCache = undefined;
    if (isCriteriaPath(path)) { this.criteriaNotes.set(path, raw); this.reparseSummaries(); return; }
    if (isRoutine(path, this.settings.routinesFolder)) {
      if (!isSummaryPath(path)) return;
      // Only a dated summary counts; a summary template never becomes a source or write target.
      if (!isRoutineSummary(path, raw)) { this.routineSummaries.delete(path); this.summaries.delete(path); return; }
      this.routineSummaries.add(path);
    }
    if (dateFromPath(path)) {
      if (isPlannerDay(raw)) this.days.set(path, parseDay(raw, path, this.settings.projectCodes)); else this.days.delete(path);
    }
    else if (path === this.settings.summaryPath || isSummaryPath(path)) this.summaries.set(path, this.summaryOf(raw, path));
  }
  /** The vault's day-marker criteria from thejaz-criteria.md; null uses built-in minute defaults. */
  criteria(): MarkerCriteria | null { return vaultCriteria(this.criteriaNotes); }
  criteriaPath(): string | undefined { return [...this.criteriaNotes.keys()].sort()[0]; }
  private summaryOf(raw: string, path: string): Summary { return parseSummary(raw, path, this.settings.weekendDays, this.criteria()); }
  private reparseSummaries(): void { for (const [path, summary] of this.summaries) this.summaries.set(path, this.summaryOf(summary.text, path)); }
  async getDay(date: string): Promise<Day | null> {
    const matching = [...this.days.values()].filter(d => d.date === date);
    let path = matching.length ? chooseDay(matching, folderCounts(this.days.values())).chosen.path : dailyNotePath(date);
    let raw = await this.port.read(path);
    // Before indexing finishes, a plan under the plain name must not be missed (and then duplicated).
    if (!matching.length && path !== `${date}.md` && (raw === null || !isPlannerDay(raw))) {
      const plain = await this.port.read(`${date}.md`);
      if (plain !== null && isPlannerDay(plain)) { path = `${date}.md`; raw = plain; }
    }
    // A note with the day's name that is not a plan belongs to someone else.
    if (raw === null || !isPlannerDay(raw)) return null;
    const day = parseDay(raw, path, this.settings.projectCodes);
    if (!this.timers.has(path)) {
      // Only a changed note can change the streak or records; plain navigation keeps the caches.
      if (this.days.get(path)?.text !== raw) { this.streakCache = undefined; this.recordsCache = undefined; }
      this.days.set(path, day);
    }
    return day;
  }
  notifyFile(file: TFile): void {
    if (this.ownWrites.has(file.path)) return;
    if (isRoutine(file.path, this.settings.routinesFolder) && !file.path.includes('/_archive/')) {
      this.registerRoutine(file);
      if (!isSummaryPath(file.path) && file.path !== this.settings.summaryPath && !isCriteriaPath(file.path)) return;
    }
    if (isCriteriaPath(file.path)) {
      void this.port.read(file.path).then(raw => {
        if (raw === null) this.remove(file.path);
        else { this.ingest(file.path, raw); void this.enqueue(() => this.checkSummaryStatus()).catch(error => this.report(error)); this.emit(); }
      }).catch(error => this.report(error, file.path));
      return;
    }
    if (!dateFromPath(file.path) && file.path !== this.settings.summaryPath && !isSummaryPath(file.path)) return;
    if (!this.baselines.has(file.path)) this.baselines.set(file.path, this.days.get(file.path));
    this.unindexed.add(file.path);
    window.clearTimeout(this.timers.get(file.path));
    this.timers.set(file.path, window.setTimeout(() => {
      this.timers.delete(file.path);
      const before = this.baselines.get(file.path); this.baselines.delete(file.path);
      void this.enqueue(() => this.manualUpdate(file.path, before)).catch(e => this.report(e, file.path));
    }, 450));
  }
  private async manualUpdate(path: string, before: Day | undefined): Promise<void> {
    if (!this.alive) return;
    // Cleared before reading: an edit made while reading marks the note again.
    this.unindexed.delete(path);
    const start = performance.now(), raw = await this.port.read(path);
    if (raw === null) { this.remove(path); return; }
    this.ingest(path, raw);
    const date = dateFromPath(path);
    await this.synchronizeProjects(date ? new Set([date]) : undefined, this.settings.autoUpdate && !!date);
    if (before) before = parseDay(before.text, before.path, this.settings.projectCodes);
    const after = this.days.get(path);
    if (after && this.settings.autoUpdate && (!before || before.text !== raw) && after.recordedOnly) {
      if (!disputed(after)) await this.updateSummary(after.date ? new Set([after.date]) : new Set(), null, before);
    } else if (after && before && this.settings.autoUpdate && before.text !== raw && !before.recordedOnly && !before.legacy && !after.legacy) {
      const footersUnchanged = JSON.stringify(before.footers.map(f => [f.code, f.value])) === JSON.stringify(after.footers.map(f => [f.code, f.value]));
      if (!footersUnchanged && disputed(after)) {
        this.issues.set(path, 'The totals at the bottom of this note no longer match its completed activities. Your numbers were kept. Choose Compare totals, or open the note to fix the activities.');
      } else if (footersUnchanged && !this.userDisputed(before) && !after.diagnostics.some(d => d.blocks)) {
        const change = changeOf(after, footerPatches(after, false, this.settings.projectCodes), 'Update calculated totals');
        const op = await this.journal.perform([change], change.label, true);
        const updated = await this.port.read(path);
        if (updated !== null) this.ingest(path, updated);
        await this.updateSummary(after.date ? new Set([after.date]) : new Set(), op, before);
      }
    }
    if (after && !disputed(this.days.get(path) ?? after)) this.issues.delete(path);
    await this.checkSummaryStatus();
    this.performance.automaticUpdates.push(performance.now() - start);
    this.scheduleCache(); this.emit();
  }
  remove(path: string): void { if (this.criteriaNotes.delete(path)) this.reparseSummaries(); this.days.delete(path); this.summaries.delete(path); this.routinePaths.delete(path); this.routineSummaries.delete(path); this.emit(); this.scheduleCache(); }
  private isTemplate(path: string): boolean { return isRoutine(path, this.settings.routinesFolder) && !this.routineSummaries.has(path); }
  rename(oldPath: string, file: TFile): void {
    // A summary paused by the overwrite guard stays paused under its new name.
    if (this.pausedSummaries.delete(oldPath)) this.pausedSummaries.add(file.path);
    let settingsChanged = false;
    if (this.settings.summaryPath === oldPath) { this.settings.summaryPath = file.path; settingsChanged = true; }
    if (settingsChanged) void this.enqueue(() => this.saveSettings()).catch(error => this.report(error));
    this.remove(oldPath); this.routinePaths.delete(oldPath);
    // A template moved into (or within) the routines folder is offered at once, not after a rebuild.
    if (isRoutine(file.path, this.settings.routinesFolder) && !file.path.includes('/_archive/')) this.registerRoutine(file);
    void this.port.read(file.path).then(raw => { if (raw !== null) this.ingest(file.path, raw); this.emit(); })
      .catch(error => this.report(error, file.path));
  }
  /** Lists a note in the routines folder as a plan template when it looks like one. */
  private registerRoutine(file: TFile): void {
    void this.app.vault.cachedRead(file).then(text => {
      if (/^##\s+plan for\b/im.test(text) || /^###\s+(morning|afternoon|evening)\s*$/im.test(text)) this.routinePaths.add(file.path);
      else this.routinePaths.delete(file.path);
    }).catch(() => this.routinePaths.delete(file.path));
  }
  /**
   * The note text from the planner's most recent write that changed `path`'s footer
   * totals (from the recovery journal). Footers the planner never set are not its own.
   */
  private plannerFooterText(path: string): string | undefined {
    const footer = (text: string | null) => text === null ? '' : footerSignature(parseDay(text, path, this.settings.projectCodes));
    const operations = [...this.journal.data.operations].filter(o => o.state === 'done').sort((a, b) => b.time - a.time);
    for (const operation of operations)
      for (const write of operation.writes.filter(w => w.path === path).reverse()) {
        // Daily notes keep their prior text in the journal, so both sides are always known.
        const texts = writeTexts(write);
        if (texts?.after != null && footer(texts.before) !== footer(texts.after)) return texts.after;
      }
    return undefined;
  }
  /** Differing totals the user recorded, as opposed to a footer lagging behind the planner's own writes. */
  private userDisputed(day: Day): boolean { return userDisputed(day, this.plannerFooterText(day.path), this.settings.projectCodes); }
  /** Resolves once queued planner writes have finished. */
  async whenIdle(): Promise<void> { await this.mutation; }
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const promise = this.mutation.then(fn, fn);
    this.mutation = promise.catch(() => undefined); return promise;
  }
  async apply(change: Change, reconcile = false): Promise<void> {
    return this.enqueue(async () => {
      const start = performance.now();
      const beforeRaw = await this.port.read(change.path);
      if (beforeRaw === null) throw new Conflict('The note is no longer available.');
      const before = parseDay(beforeRaw, change.path, this.settings.projectCodes);
      if (before.recordedOnly) throw new Error('Edit recorded totals in the Markdown source. Activity operations are unavailable for this day.');
      if (before.legacy) throw new Error('This older format is available for reading. Open its Markdown source to edit it.');
      // Journal will safely rebase if an unrelated edit occurred after this view was rendered.
      await this.whenStarted();
      let op = await this.journal.perform([change], change.label, true);
      const current = await this.port.read(change.path);
      if (current === null) throw new Conflict('The note was moved or renamed while saving. Open it and try again.');
      let after = parseDay(current, change.path, this.settings.projectCodes);
      if ((this.settings.autoUpdate || reconcile) && (reconcile || !this.userDisputed(before)) && !after.legacy && !after.diagnostics.some(d => d.blocks)) {
        const footer = changeOf(after, footerPatches(after, false, this.settings.projectCodes), change.label);
        if (op) await this.journal.append(op, footer);
        else if (footer.patches.length) op = await this.journal.perform([footer], change.label, true);
        const updated = await this.port.read(change.path);
        if (updated === null) throw new Conflict('The note was moved or renamed while saving. Open it and try again.');
        after = parseDay(updated, change.path, this.settings.projectCodes);
        this.issues.delete(change.path);
      }
      this.days.set(change.path, after);
      await this.synchronizeProjects(after.date ? new Set([after.date]) : undefined, this.settings.autoUpdate || reconcile, op);
      if (this.settings.autoUpdate || reconcile) await this.updateSummary(after.date ? new Set([after.date]) : new Set(), op, before);
      else if (op) await this.journal.finishSummary(op);
      await this.checkSummaryStatus();
      this.performance.operations.push(performance.now() - start);
      this.scheduleCache(); this.emit();
    });
  }
  /** Create the day's note; with `adopt`, add the plan on top of a non-plan note that holds the name. */
  async create(date: string, routinePath: string, adopt = false): Promise<Day> {
    await this.whenStarted();
    const day = await this.enqueue(async () => {
      // A plan in a subfolder or under an earlier name may not have reached the index yet.
      // Check candidates before creating a second note for its date.
      for (const file of this.app.vault.getMarkdownFiles()) {
        if (dateFromPath(file.name) === date && !this.days.has(file.path) && !isRoutine(file.path, this.settings.routinesFolder))
          this.ingest(file.path, await this.app.vault.cachedRead(file));
      }
      const existing = await this.getDay(date);
      if (existing) return existing;
      const path = dailyNotePath(date), taken = await this.port.read(path);
      if (taken !== null && !adopt) throw new NameTaken(path);
      // Choosing the ordinary-day offer writes it as a real routine note and uses that note.
      let note: { path: string; content: string; exists: string } | null = null;
      if (routinePath === ORDINARY_DAY_OFFER) ({ path: routinePath, note } = await this.ordinaryDayNote());
      const routine = note ? note.content : routinePath ? await this.readRoutine(routinePath) : '';
      if (routinePath && routine === null) throw new Error('The selected routine is no longer available.');
      const text = taken === null ? makeDay(date, routine ?? '') : adoptDay(taken, date, routine ?? '');
      // The new routine note and the day are one step, so a single Undo removes both.
      if (taken === null) await this.journal.createAll([...(note ? [note] : []), { path, content: text, exists: 'This day already exists; open it instead.' }], 'Create day');
      else {
        if (note) await this.journal.createAll([note], 'Add ordinary day routine');
        // Insert before the note's first byte (after a BOM), so its own text stays exactly as it was.
        const at = taken.startsWith('\uFEFF') ? 1 : 0;
        await this.journal.perform([{ path, base: taken, label: 'Create day', patches: [patch(taken, at, at, text.slice(at, text.length - taken.length + at))] }], 'Create day');
      }
      if (note) this.routinePaths.add(note.path);
      // Remembering the routine is a convenience: the day already exists, so a failed save here must not report failure.
      const lastRoutine = this.settings.lastRoutine; this.settings.lastRoutine = routinePath;
      try { await this.saveSettings(); } catch { this.settings.lastRoutine = lastRoutine; }
      const created = parseDay(text, path, this.settings.projectCodes);
      this.days.set(created.path, created);
      return created;
    });
    this.emit(); this.scheduleCache();
    return day;
  }
  routines(): TFile[] {
    return this.app.vault.getMarkdownFiles().filter(f => isRoutine(f.path, this.settings.routinesFolder) && this.routinePaths.has(f.path)).sort((a, b) => a.path.localeCompare(b.path));
  }
  /**
   * Routines offered in Create day and Replace plan: the user's notes, then the ordinary-day
   * offer while no routine of that name exists.
   */
  routineChoices(): RoutineChoice[] {
    const own = this.routines().map(file => ({ path: file.path, name: file.basename }));
    // The offer needs a routines folder to live in.
    if (!this.routinesRoot() || own.some(choice => choice.name === ORDINARY_DAY_NAME)) return own;
    return [...own, { path: ORDINARY_DAY_OFFER, name: ORDINARY_DAY_NAME }];
  }
  /** The routines folder setting as a vault path, or '' when none is set. */
  private routinesRoot(): string {
    const root = routinesRoot(this.settings.routinesFolder);
    return root ? normalizePath(root) : '';
  }
  /** A routine's text: the offered ordinary day before its note exists, or the note itself. */
  private async readRoutine(path: string): Promise<string | null> {
    return path === ORDINARY_DAY_OFFER ? ORDINARY_DAY_NOTE : this.port.read(path);
  }
  /**
   * Where the offered ordinary day goes: `🌞 ordinary day.md` in the routines folder (an
   * existing folder is matched regardless of letter case, a missing one is created). `note`
   * is the note still to write, or null when one of that name is already there to use.
   */
  private async ordinaryDayNote(): Promise<{ path: string; note: { path: string; content: string; exists: string } | null }> {
    const root = this.routinesRoot();
    if (!root) throw new Error('Set a routines folder in Planner settings first. Nothing was written.');
    const existing = this.app.vault.getAllLoadedFiles().find(file => file instanceof TFolder && file.path.toLowerCase() === root.toLowerCase());
    const path = `${existing?.path ?? root}/${ORDINARY_DAY_NAME}.md`;
    if (await this.port.read(path) !== null) return { path, note: null };
    if (!existing) await this.app.vault.createFolder(root);
    return { path, note: { path, content: ORDINARY_DAY_NOTE, exists: `${path} was added meanwhile, so nothing was written. Choose ${ORDINARY_DAY_NAME} again to use it.` } };
  }
  /** Writes the offered ordinary day as a routine note (one undoable step) and returns its path. */
  private async addOrdinaryDay(): Promise<string> {
    const { path, note } = await this.ordinaryDayNote();
    if (note) await this.journal.createAll([note], 'Add ordinary day routine');
    this.routinePaths.add(path);
    return path;
  }
  async previewPlanReplacement(date: string, templatePath: string): Promise<PlanReplacement & { templatePath: string; templateText: string }> {
    if (!templatePath || !this.routineChoices().some(choice => choice.path === templatePath)) throw new Error('Choose an available plan template.');
    const day = await this.getDay(date);
    if (!day) throw new Error('This day does not exist yet. Use Create day instead.');
    if (day.path === templatePath) throw new Error('Choose a template different from the daily note.');
    const templateText = await this.readRoutine(templatePath);
    if (templateText === null) throw new Error('The selected template was moved or removed. Choose another template.');
    return { ...replacePlan(day, templateText, this.codesFor(day)), templatePath, templateText };
  }
  async applyPlanReplacement(plan: PlanReplacement & { templatePath: string; templateText: string }): Promise<void> {
    const offer = plan.templatePath === ORDINARY_DAY_OFFER;
    if (!offer && await this.port.read(plan.templatePath) !== plan.templateText) throw new Conflict('The template changed after the preview. Preview it again before replacing the plan.');
    await this.apply(plan.change, true);
    // The routine note is written only once the plan is replaced, in the mutation queue.
    let templatePath = plan.templatePath;
    if (offer) {
      try { templatePath = await this.enqueue(() => this.addOrdinaryDay()); }
      catch (error) { this.report(new Error(`The plan was replaced, but ${ORDINARY_DAY_NAME} could not be added to your routines folder (${message(error)}). Your notes are safe; choose it again to add it.`)); return; }
    }
    try { await this.enqueue(async () => { this.settings.lastRoutine = templatePath; await this.saveSettings(); }); }
    catch { this.report(new Error('The plan was replaced, but the template preference could not be saved.')); }
  }
  private async updateSummary(dates: Set<string>, operation: Operation | null, before?: Day, reconcile = false): Promise<void> {
    if (!dates.size || reconcile) return this.updateSummaryPath(this.settings.summaryPath, dates, operation, before, reconcile);
    const targets = new Map<string, Set<string>>(); let blocked = false;
    for (const date of dates) {
      try {
        const summary = summaryForDate(date, this.summarySources());
        targets.set(summary.path, new Set([...(targets.get(summary.path) ?? []), date])); this.issues.delete(`summary-period:${date}`);
      } catch (error) { this.issues.set(`summary-period:${date}`, message(error)); blocked = true; }
    }
    for (const [path, ownedDates] of targets) await this.updateSummaryPath(path, ownedDates, operation, before, false);
    if (blocked && operation) { operation.summaryPending = true; await this.journal.save(); }
  }
  private async updateSummaryPath(path: string, dates: Set<string>, operation: Operation | null, before?: Day, reconcile = false, expected?: SummaryPreview): Promise<void> {
    if (!this.indexed) {
      if (operation) this.deferredSummaries.add(operation.id);
      this.issues.set('summary', 'Your edit is saved. The summary will update automatically once the planner has finished reading your notes.'); return;
    }
    const raw = await this.port.read(path);
    if (raw === null) { this.issues.set('summary', 'The summary note was not found. Set its location in Planner settings, under Summary note.'); return; }
    if (expected && raw !== expected.text) throw new Conflict(PREVIEW_CHANGED);
    const summary = this.summaryOf(raw, path);
    if (!reconcile && summary.start && summary.end && dates.size &&
      [...dates].every(date => date < summary.start! || date > summary.end!)) {
      if (operation) await this.journal.finishSummary(operation);
      return;
    }
    // An existing aggregate discrepancy must not be silently repaired as a side effect.
    const through = this.now().date;
    let current: Review | undefined;
    if (before && summary.start && summary.end && !reconcile) {
      const baseline = [...this.days.values()].filter(d => d.path !== before.path).concat(before);
      const end = through < summary.end ? through : summary.end;
      if (end >= summary.start) {
        const prior = review(baseline, summary.start, end);
        current = review(this.days.values(), summary.start, end);
        if (prior.complete && summary.projects.some(p => p.value !== (prior.projects[p.code] ?? 0) && p.value !== (current!.projects[p.code] ?? 0))) {
          // The summary status check explains the pause, naming each differing project.
          this.pausedSummaries.add(path); return;
        }
      }
    }
    // `current` covers the same period and days as summaryPatches would; nothing was awaited since.
    const update = summaryPatches(summary, this.days.values(), through, dates, reconcile, current, () => this.recordBests(summary));
    // Write exactly what was reviewed: a daily note edited since would change the figures.
    if (expected && JSON.stringify(update.patches) !== JSON.stringify(expected.patches)) throw new Conflict(PREVIEW_CHANGED);
    const interim = applyPatches(raw, update.patches);
    const final = applyPatches(interim, summaryEmojiChanges(parseSummary(interim, path), this.settings.projectEmojis).patches);
    const change: Change = { path, base: raw, patches: minimalDiff(raw, final), label: 'Update summary' };
    try {
      if (operation) await this.journal.append(operation, change);
      else if (change.patches.length) await this.journal.perform([change], change.label);
      const saved = await this.port.read(path);
      if (saved !== null) this.summaries.set(path, this.summaryOf(saved, path));
      this.pausedSummaries.delete(path);
      if (update.issues.length) this.issues.set('summary', groupDays(update.issues, SEE_REVIEW).join(' '));
      else { this.issues.delete('summary'); if (operation) await this.journal.finishSummary(operation); }
    } catch (error) { this.issues.set('summary', `Your day was saved, but the summary was not updated (${message(error)}). Choose Retry summary update.`); }
  }
  /**
   * Replace `path`'s figures with the daily notes' totals; the configured summary by default.
   * With `expected` (a Review summary preview), nothing is written unless the summary text
   * and the changes it would receive are still exactly the ones reviewed.
   */
  async reconcileSummary(path = this.settings.summaryPath, expected?: SummaryPreview): Promise<void> {
    await this.enqueue(async () => {
      // An edit its automatic update has not read yet must count, or it would match a stale preview.
      await this.refreshPendingSources();
      await this.updateSummaryPath(path, new Set(), null, undefined, true, expected);
      await this.checkSummaryStatus();
    });
    this.emit();
  }
  /** The summary note as it is now (an open editor's text), re-read into the index when the indexed copy lags. */
  async readSummary(path: string): Promise<Summary | null> {
    const raw = await this.port.read(path);
    if (raw === null) { this.remove(path); return null; }
    if (this.summaries.get(path)?.text !== raw) this.ingest(path, raw);
    return this.summaries.get(path) ?? null;
  }
  async sortSummaryProjects(): Promise<void> {
    await this.enqueue(async () => {
      const path = this.settings.summaryPath, raw = await this.port.read(path);
      if (raw === null) throw new Error('The summary note was not found. Set its location in Planner settings, under Summary note.');
      const summary = this.summaryOf(raw, path);
      await this.journal.perform([{ path, base: raw, patches: sortedProjectPatches(summary), label: 'Sort summary projects by time' }], 'Sort summary projects by time');
      const saved = await this.port.read(path); if (saved !== null) this.ingest(path, saved);
      await this.checkSummaryStatus(); this.emit(); this.scheduleCache();
    });
  }
  async retrySummary(): Promise<void> {
    await this.enqueue(async () => {
      // A previous attempt may already have reached the correct summary, or a
      // later reconciliation may have superseded an older pending checkpoint.
      // Check current records before comparing against historical baselines.
      await this.checkSummaryStatus();
      for (const op of this.journal.data.operations.filter(o => o.summaryPending && o.state === 'done')) await this.resumeSummary(op);
      await this.checkSummaryStatus();
    });
    this.emit();
  }
  /** Bring a saved edit's summary up to date, comparing against the day as it was before that edit. */
  private async resumeSummary(op: Operation): Promise<void> {
    if (isSummaryCheckpoint(op)) return; // Verification must not silently reconcile current figures.
    const dates = new Set(op.writes.map(w => dateFromPath(w.path)).filter((v): v is string => v !== null));
    const firstSource = op.writes.find(w => dateFromPath(w.path) && w.before !== null);
    const before = firstSource?.before ? parseDay(firstSource.before, firstSource.path, this.settings.projectCodes) : undefined;
    await this.updateSummary(dates, op, before);
  }
  /** Finish the summary updates of edits made while indexing; earlier sessions' pending work stays manual. */
  private async finishDeferredSummaries(): Promise<void> {
    const ids = new Set(this.deferredSummaries); this.deferredSummaries.clear();
    for (const op of this.journal.data.operations.filter(o => ids.has(o.id) && o.summaryPending && o.state === 'done')) await this.resumeSummary(op);
    this.emit(); this.scheduleCache();
  }
  private syncRecoveryIssue(): void {
    const operations = this.journal.data.operations;
    const interrupted = operations.filter(o => o.state === 'interrupted' || o.state === 'pending').length;
    const saved = operations.filter(o => o.state === 'done' && o.summaryPending).length;
    const checkpoints = operations.filter(o => (o.state === 'interrupted' || o.state === 'pending') && isSummaryCheckpoint(o)).length;
    if (interrupted) this.issues.set('recovery', checkpoints === interrupted
      ? `${checkpoints} saved edit${checkpoints === 1 ? '' : 's'} still need${checkpoints === 1 ? 's' : ''} a quick summary check. Your notes are fine. Choose Check again, or Finish interrupted edits to see which.`
      : `${interrupted} planner edit${interrupted === 1 ? '' : 's'} stopped partway. Your notes are safe. Choose Finish interrupted edits.`);
    else if (saved && !this.issues.has('summary') && ![...this.issues.keys()].some(key => key.startsWith(WAITING))) this.issues.set('recovery', `${saved} saved edit${saved === 1 ? ' has' : 's have'} not reached the summary yet. Choose Retry summary update.`);
    else this.issues.delete('recovery');
  }
  private checkpointScope(): string {
    return JSON.stringify({ codes: this.settings.projectCodes, weekends: this.settings.weekendDays,
      summary: this.settings.summaryPath, routines: this.settings.routinesFolder,
      files: this.app.vault.getMarkdownFiles()
        .filter(f => !this.isTemplate(f.path) && (dateFromPath(f.path) || isSummaryPath(f.path) || f.path === this.settings.summaryPath))
        .map(f => ({ path: f.path, mtime: f.stat.mtime, size: f.stat.size })).sort((a, b) => a.path.localeCompare(b.path)) });
  }
  private async verifySummaryCheckpoints(): Promise<void> {
    for (const [key] of this.issues) if (key.startsWith('checkpoint:')) this.issues.delete(key);
    for (const operation of this.journal.data.operations.filter(o => isSummaryCheckpoint(o) && ['pending', 'interrupted', 'done'].includes(o.state))) {
      try {
        const scope = this.checkpointScope(), guards: { path: string; text: string }[] = [];
        const files = this.app.vault.getMarkdownFiles().filter(f => !this.isTemplate(f.path));
        const summaries: Summary[] = [];
        for (const file of files.filter(f => isSummaryPath(f.path) || f.path === this.settings.summaryPath)) {
          const text = await this.port.read(file.path);
          if (text === null) throw new Conflict(`${file.path} was removed while checking. Choose Check again.`);
          guards.push({ path: file.path, text }); summaries.push(this.summaryOf(text, file.path));
        }
        const dates = new Set(operation.writes.map(w => dateFromPath(w.path)!));
        const owners = [...dates].map(date => summaryForDate(date, summaries));
        const days: Day[] = [];
        for (const file of files.filter(f => {
          const date = dateFromPath(f.path);
          return date && owners.some(s => s.start! <= date && date <= s.end!);
        })) {
          const text = await this.port.read(file.path);
          if (text === null) throw new Conflict(`${file.path} was removed while checking. Choose Check again.`);
          guards.push({ path: file.path, text }); if (isPlannerDay(text)) days.push(parseDay(text, file.path, this.settings.projectCodes));
        }
        const issues = checkpointIssues(days, summaries, dates, this.now().date);
        if (issues.length) throw new Error(groupDays(issues).join(' '));
        await this.journal.resolveCheckpoint(operation, guards, () => {
          if (this.checkpointScope() !== scope) throw new Conflict('Notes or settings changed while checking. Choose Check again.');
        });
      } catch (error) { this.issues.set(`checkpoint:${operation.id}`, `Summary check for ${operation.writes.map(w => w.path.split('/').pop()).join(', ')} could not be confirmed: ${message(error)}`); }
    }
  }
  /** Validate current state without writing Markdown or replaying old operations. */
  private async checkSummaryStatus(): Promise<void> {
    if (!this.indexed) { this.syncRecoveryIssue(); return; }
    await this.verifySummaryCheckpoints();
    // A completed check supersedes errors from earlier failed actions or startup.
    this.notices.clear(['operation', 'startup']);
    const path = this.settings.summaryPath, raw = await this.port.read(path);
    if (raw === null) this.summaries.delete(path);
    const summary = raw === null ? null : this.summaryOf(raw, path);
    if (summary) this.summaries.set(path, summary);
    // One period total per summary serves the full check and every pending edit.
    const totals = new TotalsMemo(() => this.days.values(), this.now().date, undefined, target => this.recordBests(target));
    const full = summary ? totals.patches(summary, new Set(), true) : null;
    // Edits for other summaries are settled and explained even without the configured one.
    const pending = this.journal.data.operations.filter(o => o.state === 'done' && o.summaryPending && o.writes.every(w => w.state === 'saved') && !isSummaryCheckpoint(o));
    await settlePending(pending, op => new Set(op.writes.map(w => dateFromPath(w.path)).filter((d): d is string => d !== null)),
      () => this.summarySources(), totals, op => this.journal.finishSummary(op));
    const waitingHere = this.describeWaiting(totals);
    if (!summary || !full) {
      this.issues.set('summary', 'The summary note was not found. Set its location in Planner settings, under Summary note.');
      this.syncRecoveryIssue(); return;
    }
    const messages: string[] = [];
    if (waitingHere) messages.push(`${waitingHere.toLocaleString('en-US')} saved edit${waitingHere === 1 ? ' is' : 's are'} waiting for the summary. Choose Retry summary update to add ${waitingHere === 1 ? 'it' : 'them'}.`);
    // A paused summary has its own entry naming the differing projects.
    if (materialPatches(full.patches).length && !this.issues.has(`${WAITING}${path}`)) messages.push('The summary does not match your daily notes yet. Choose Review summary to see the differences, then Update summary.');
    if (full.issues.length) messages.push(summary.start && summary.end
      ? 'Some days need fixing before the summary can be completed. Choose Review summary; each day has its own button.'
      : 'The summary\'s Days line (YYYY-MM-DD - YYYY-MM-DD) is missing or unreadable. Choose Open summary note to fix it.', ...groupDays(full.issues));
    if (messages.length) this.issues.set('summary', messages.join(' '));
    else this.issues.delete('summary');
    for (const [key] of this.issues) {
      const day = this.days.get(key);
      if (day && !disputed(day)) this.issues.delete(key);
    }
    this.syncRecoveryIssue();
  }
  /**
   * Explain saved edits that have not reached their summary, one entry per paused or
   * older summary. Returns the configured summary's waiting count when it is not paused;
   * its own summary message carries that count.
   */
  private describeWaiting(totals: TotalsMemo): number {
    for (const [key] of this.issues) if (key.startsWith(WAITING)) this.issues.delete(key);
    const waiting = new Map<Summary, number>();
    for (const op of this.journal.data.operations.filter(o => o.state === 'done' && o.summaryPending && !isSummaryCheckpoint(o))) {
      const owners = new Set<Summary>();
      for (const write of op.writes) {
        const date = dateFromPath(write.path);
        if (date) try { owners.add(summaryForDate(date, this.summarySources())); } catch { /* Reported as a summary-period issue. */ }
      }
      for (const owner of owners) waiting.set(owner, (waiting.get(owner) ?? 0) + 1);
    }
    for (const path of this.pausedSummaries) {
      const summary = this.summarySources().find(s => s.path === path);
      if (summary) { if (!waiting.has(summary)) waiting.set(summary, 0); } else this.pausedSummaries.delete(path);
    }
    let current = 0;
    for (const [summary, count] of waiting) {
      // Only the overwrite guard pauses an update; a merely delayed one still differs until Retry.
      const review = totals.get(summary), paused = this.pausedSummaries.has(summary.path) ? projectDifferences(summary, review) : [];
      if (!paused.length) this.pausedSummaries.delete(summary.path);
      const main = summary.path === this.settings.summaryPath;
      if (main && !paused.length) { current = count; continue; }
      if (!paused.length && !count) continue;
      const name = main ? 'the summary' : summary.path.split('/').pop()!.replace(/\.md$/i, '');
      this.issues.set(`${WAITING}${summary.path}`, waitingMessage(name, count, paused, !!summary.start && !review?.complete));
    }
    return current;
  }
  /**
   * Read notes edited since their automatic update last read them into the index: those
   * within the debounce interval and those whose update still waits in the queue. Their
   * automatic updates are not applied here; they still run in turn.
   */
  private async refreshPendingSources(): Promise<void> {
    for (const path of [...this.unindexed]) {
      const raw = await this.port.read(path);
      if (raw !== null) this.ingest(path, raw);
    }
  }
  async recheckSummary(): Promise<void> {
    await this.enqueue(async () => {
      await this.refreshPendingSources();
      this.notices.clear();
      await this.checkSummaryStatus();
    });
    this.emit();
  }
  async recover(): Promise<void> {
    await this.enqueue(async () => {
      await this.verifySummaryCheckpoints();
      // One blocked operation must not hide others; resuming one can also complete an older one's work.
      let failure: unknown, progressed = true;
      while (progressed) {
        progressed = false; failure = undefined;
        for (const operation of this.journal.data.operations.filter(o => o.state === 'interrupted' || o.state === 'pending')) {
          try {
            if (isSummaryCheckpoint(operation)) throw new Conflict(this.issues.get(`checkpoint:${operation.id}`) ?? 'Recheck this summary checkpoint before continuing.');
            this.checkTransferScope(operation);
            await this.journal.retry(operation);
          } catch (error) { failure ??= error; continue; }
          progressed = true;
          await this.refreshOperation(operation);
          this.emit(this.transferTransition(operation));
          if (operation.summaryPending) {
            const dates = new Set(operation.writes.map(w => dateFromPath(w.path)).filter((date): date is string => date !== null));
            await this.updateSummary(dates, operation);
          }
        }
      }
      if (failure) { this.syncRecoveryIssue(); throw failure instanceof Error ? failure : new Error(message(failure)); }
      await this.synchronizeProjects();
    });
    await this.retrySummary(); this.emit(); this.scheduleCache();
  }
  async contextForDate(date: string): Promise<ContextSnapshot> {
    const sources: Summary[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (file.path !== this.settings.summaryPath && !isSummaryPath(file.path)) continue;
      const text = await this.port.read(file.path);
      if (text === null || isRoutine(file.path, this.settings.routinesFolder) && !isRoutineSummary(file.path, text)) continue;
      sources.push(this.summaryOf(text, file.path));
    }
    const summary = summaryForDate(date, sources);
    const source = this.criteriaPath();
    if (!source) throw new Error(`Day contexts are defined in ${CRITERIA_NOTE}. Create it at the vault root with a Criteria & Markers section.`);
    const sourceText = await this.port.read(source);
    if (sourceText === null) throw new Error(`${source} was not found. Rebuild the index and try again.`);
    // Parse the text just read: the cached copy can lag an edit made seconds before saving.
    const criteria = this.criteriaNotes.size > 1 ? this.criteria()! : parseMarkerCriteria(sourceText, source);
    if (criteria.issues.length) throw new Error(`${source}: ${criteria.issues[0]!.message}`);
    const rows = summary.rows.filter(row => row.date === date);
    if (rows.length !== 1 || rows[0]!.value === null) throw new Error(`${summary.path}: this date needs one row with recorded minutes. Open the summary source to correct it.`);
    const row = rows[0]!, raw = summary.lines[row.line]!.raw;
    const token = JSON.stringify([summary.path, summary.start, summary.end, raw, source, criteria, this.settings.weekendDays]);
    return { date, summary, criteria, source, sourceText, current: readContext(raw, criteria), minutes: row.value!, token };
  }
  async setContext(date: string, value: DayContext, expected?: ContextSnapshot): Promise<void> {
    await this.enqueue(async () => {
      const fresh = await this.contextForDate(date);
      if (expected && fresh.token !== expected.token) throw new Conflict('The summary row, period, or legend changed. Your choice is retained; cancel and reopen Day context to review the current data.');
      if (value === fresh.current && value !== 'multiple') return;
      const { summary, criteria, source, sourceText } = fresh, path = summary.path, text = summary.text;
      const patch = contextPatch(summary, date, value, criteria);
      const guards = [{ path: source, text: sourceText }];
      await this.journal.perform([{ path, base: text, patches: [patch], label: 'Set day context' }], 'Set day context', false, guards);
      const saved = await this.port.read(path);
      if (saved !== null) this.ingest(path, saved);
      await this.checkSummaryStatus();
      this.emit(); this.scheduleCache();
    });
  }
  async undo(): Promise<void> {
    await this.enqueue(async () => {
      const operation = await this.journal.undo();
      if (!operation) { new Notice('Nothing to undo.'); return; }
      await this.refreshOperation(operation);
      await this.checkSummaryStatus();
      this.emit(this.transferTransition(operation, true)); this.scheduleCache();
    });
  }
  async redo(): Promise<void> {
    await this.enqueue(async () => {
      const operation = await this.journal.redo();
      if (!operation) { new Notice('Nothing to redo.'); return; }
      await this.refreshOperation(operation);
      await this.checkSummaryStatus(); this.emit(this.transferTransition(operation)); this.scheduleCache();
    });
  }
  async openSource(path: string, line = 0): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error('The source note is no longer available.');
    const existing = this.app.workspace.getLeavesOfType('markdown').find(leaf => (leaf.view as { file?: TFile }).file?.path === path);
    const leaf = existing ?? this.app.workspace.getLeaf('tab');
    await leaf.openFile(file, { eState: { line }, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  report(error: unknown, key = 'operation'): void {
    const text = message(error);
    this.notices.report(key, text); this.emit();
    // Repeated failures (one per queued edit) would otherwise stack identical pop-ups.
    if (text === this.lastNotice.text && Date.now() - this.lastNotice.time < NOTICE_REPEAT_MS) return;
    this.lastNotice = { text, time: Date.now() };
    new Notice(text);
  }
  private lastNotice = { text: '', time: 0 };
  private scheduleCache(): void {
    if (!this.alive) return;
    window.clearTimeout(this.cacheTimer);
    this.cacheTimer = window.setTimeout(() => void this.saveCache().catch(() => undefined), 1200);
  }
  async saveCache(): Promise<void> {
    const files: Record<string, CacheEntry> = {};
    for (const [path, document] of [...this.days, ...this.summaries] as [string, Day | Summary][]) {
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        const { mtime, size } = file.stat;
        // Unchanged files were already compared with disk; read only changed revisions.
        const known = this.cacheVerified.get(path);
        if (reusableEntry(known, mtime, size, document.text)) { files[path] = known; continue; }
        // An editor event can update file metadata before its debounce updates
        // the parsed record. Never label stale parsed text with the new revision.
        const disk = await this.app.vault.read(file);
        if (disk === document.text && file.stat.mtime === mtime && file.stat.size === size)
          this.cacheVerified.set(path, files[path] = { mtime, size, text: document.text });
      }
    }
    for (const path of this.cacheVerified.keys()) if (!files[path]) this.cacheVerified.delete(path);
    // Many actions schedule a save without changing any note; rewriting megabytes then gains nothing.
    const revision = Object.entries(files).map(([path, entry]) => `${path}|${entry.mtime}|${entry.size}`).sort().join(',');
    if (revision === this.savedCacheRevision) return;
    await this.app.vault.adapter.write(`${this.config}/index.json`, JSON.stringify({ version: 2, files }));
    this.savedCacheRevision = revision;
  }
  /** The note revisions in the cache file as last written. */
  private savedCacheRevision = '';
  dispose(): void {
    this.alive = false;
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    window.clearTimeout(this.cacheTimer); window.clearTimeout(this.reindexTimer); this.listeners.clear();
  }
}
/** Stored settings without keys later versions retired, so a recovery write cannot bring them back. */
function withoutRetired<T extends Record<string, unknown>>(stored: T): T {
  const copy: Record<string, unknown> = { ...stored };
  for (const key of ['dailyPrefix', 'dailySuffix', 'markerSourcePath', 'roundTimes', 'roundCredits']) delete copy[key];
  return copy as T;
}
function checksum(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); }
  return hash >>> 0;
}
