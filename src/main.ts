import { addIcon, Plugin, PluginSettingTab, Setting, TFile } from 'obsidian';
import type { App } from 'obsidian';
import { Controller } from './controller';
import type { GeneralSettings } from './controller';
import { PlannerView, VIEW_TYPE } from './ui/view';
import { HelpDialog } from './ui/dialogs';
import { dateAdd } from './core/model';
import { AUTHOR_URL, PLUGIN_ICON, PLUGIN_NAME, SUN_SVG } from './branding';
import { reviewSettings } from './ui/review-settings';
import { entrySettings } from './ui/entry-settings';
import { projectSettings } from './ui/project-settings';
import { openPlannerSettings } from './ui/open-settings';
import { actionFeedback, rebuildResult, retryResult, undoResult, showRebuild, quietSettingsLabels } from './ui/settings-feedback';

export default class PlannerPlugin extends Plugin {
  controller!: Controller;
  onload(): void {
    addIcon(PLUGIN_ICON, SUN_SVG);
    this.controller = new Controller(this.app, this);
    this.registerView(VIEW_TYPE, leaf => new PlannerView(leaf, this.controller));
    this.addRibbonIcon(PLUGIN_ICON, `Open ${PLUGIN_NAME}`, () => void this.open());
    const commands: [string, string, (view: PlannerView) => unknown][] = [
      ['open', 'Open planner', () => undefined],
      ['quick-entry', 'Focus quick entry', v => v.focusEntry()],
      ['log', 'Log completed work', v => v.capture('log')],
      ['plan', 'Plan an activity', v => v.capture('plan')],
      ['submit', 'Submit quick entry', v => v.submit()],
      ['today', 'Go to today', v => v.navigate(this.controller.now().date)],
      ['previous-day', 'Go to previous day', v => v.navigate(dateAdd(v.date, -1))],
      ['next-day', 'Go to next day', v => v.navigate(dateAdd(v.date, 1))],
      ['new-day', 'Create day from a routine', v => v.newDay()],
      ['replace-plan', 'Replace current day plan from template', v => v.replacePlan()],
      ['new-project', 'Add new project', v => v.addProject()],
      ['manage-project', 'Manage projects', v => v.manageProject()],
      ['edit', 'Edit selected activity', v => v.edit()],
      ['toggle', 'Toggle selected activity completion', v => v.toggle()],
      ['duplicate', 'Duplicate selected activity as a plan', v => v.duplicate()],
      ['delete', 'Delete selected activities', v => v.delete()],
      ['move-up', 'Move selected activity up', v => v.move(-1)],
      ['move-down', 'Move selected activity down', v => v.move(1)],
      ['shift', 'Shift selected plans', v => v.shift()],
      ['correct-plans', 'Correct selected plans', v => v.correct()],
      ['compact', 'Compact daily footer', v => v.compact()],
      ['reconcile-day', 'Reconcile daily totals', v => v.reconcile()],
      ['source', 'Open selected source line', v => v.openSource()],
      ['day', 'Open Activity view', v => v.switchMode('day')],
      ['review', 'Open Report view', v => v.switchMode('review')],
      ['toggle-view', 'Toggle Activity / Report', v => v.toggleMode()],
      ['focus-activities', 'Focus activities', v => v.focusActivities()],
      ['undo', 'Undo last planner operation', () => this.controller.undo()],
      ['redo', 'Redo last undone planner operation', () => this.controller.redo()],
      ['retry-summary', 'Retry pending summary', () => this.controller.retrySummary()],
      ['reconcile-summary', 'Review summary reconciliation', v => v.summaryPreview()],
      ['sort-summary-projects', 'Sort summary projects by time', () => this.controller.sortSummaryProjects()],
      ['recover', 'Review interrupted operations', v => v.recovery()],
      ['day-context', 'Set day context', v => v.context()],
      ['rebuild-index', 'Rebuild archive index', () => showRebuild(this.controller)],
      ['help', 'Help and keyboard reference', () => new HelpDialog(this.app).open()]
    ];
    for (const [id, name, action] of commands) this.addCommand({ id, name, callback: () => {
      void this.open().then(action).catch(error => this.controller.report(error));
    } });
    this.addCommand({ id: 'open-settings', name: 'Open settings', callback: () => openPlannerSettings(this.app, this.manifest.id) });
    this.addSettingTab(new PlannerSettings(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      void this.ready().catch(error => this.controller.report(error, 'startup'));
    });
  }
  private async ready(): Promise<void> {
    await this.controller.initialize();
    if (!this.controller.isAlive) return;
    this.registerEvent(this.app.vault.on('modify', file => { if (file instanceof TFile) this.controller.notifyFile(file); }));
    this.registerEvent(this.app.vault.on('create', file => { if (file instanceof TFile) this.controller.notifyFile(file); }));
    this.registerEvent(this.app.vault.on('delete', file => this.controller.remove(file.path)));
    this.registerEvent(this.app.vault.on('rename', (file, old) => { if (file instanceof TFile) this.controller.rename(old, file); }));
    this.registerEvent(this.app.workspace.on('editor-change', (_editor, info) => { if (info.file) this.controller.notifyFile(info.file); }));
    this.controller.emit();
    await this.controller.index();
  }
  async open(): Promise<PlannerView> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? this.app.workspace.getLeaf('tab');
    if (!existing) await leaf.setViewState({ type: VIEW_TYPE, active: true });
    await this.app.workspace.revealLeaf(leaf);
    const view = leaf.view as PlannerView;
    // Opening the planner puts keyboard focus in it, so its shortcuts work at once.
    if (!view.contentEl.contains(view.contentEl.ownerDocument.activeElement)) view.contentEl.focus({ preventScroll: true });
    return view;
  }
  onunload(): void { this.controller.dispose(); }
}

class PlannerSettings extends PluginSettingTab {
  private clearProjects?: () => void;
  hide(): void { this.clearProjects?.(); this.clearProjects = undefined; }
  constructor(app: App, private planner: PlannerPlugin) { super(app, planner); }
  display(): void {
    this.clearProjects?.();
    const c = this.planner.controller, settings = c.settings;
    this.containerEl.addClass('planner-settings');
    this.containerEl.empty();
    const credit = this.containerEl.createEl('p');
    credit.appendText('Created by ');
    credit.createEl('a', { text: 'THEJAZ', href: AUTHOR_URL });
    const nav = this.containerEl.createEl('nav', { cls: 'planner-settings-nav', attr: { 'aria-labelledby': 'planner-settings-navigation-label' } });
    nav.createSpan({ text: 'Planner settings sections', cls: 'planner-sr-only', attr: { id: 'planner-settings-navigation-label' } });
    const section = (id: string, title: string, description: string) => {
      const headingId = `planner-settings-${id}-heading`;
      const root = this.containerEl.createEl('section', { cls: 'planner-settings-section', attr: { id: `planner-settings-${id}`, 'aria-labelledby': headingId } });
      const heading = new Setting(root).setName(title).setHeading().settingEl;
      heading.setAttrs({ id: headingId, tabindex: '-1', role: 'heading', 'aria-level': '3' });
      if (description) root.createEl('p', { text: description, cls: 'planner-settings-intro' });
      const link = nav.createEl('a', { text: title, href: `#planner-settings-${id}` });
      link.onclick = event => { event.preventDefault(); heading.scrollIntoView({ block: 'start' }); heading.focus({ preventScroll: true }); };
      return root;
    };
    const general = section('daily', 'Daily setup', 'Saved automatically.');
    const saved = general.createEl('p', { cls: 'planner-settings-status', attr: { role: 'status', 'aria-live': 'polite' } });
    let saveVersion = 0;
    const saveGeneral = (changes: GeneralSettings) => {
      const version = ++saveVersion;
      saved.setText('Saving…');
      void c.updateSettings(changes).then(() => { if (version === saveVersion) { saved.removeClass('planner-error'); saved.setText('Saved.'); } })
        .catch(error => { if (version === saveVersion) { saved.addClass('planner-error'); saved.setText(error instanceof Error ? error.message : String(error)); } });
    };
    new Setting(general).setName('Automatic totals').setDesc('Update unambiguous daily and summary totals after edits. Disputed figures stay unchanged.')
      .addToggle(toggle => toggle.setValue(settings.autoUpdate).onChange(value => saveGeneral({ autoUpdate: value })));
    new Setting(general).setName('Summary note').setDesc('Default summary for current work. Historical summaries are found by “thejaz-summary” in their filenames.')
      .addText(text => { text.setValue(settings.summaryPath).onChange(value => saveGeneral({ summaryPath: value.trim() })); text.inputEl.setAttribute('aria-label', 'Summary note'); });
    new Setting(general).setName('Routines folder').setDesc('Folder containing your Markdown plan templates.')
      .addText(text => { text.setValue(settings.routinesFolder).onChange(value => saveGeneral({ routinesFolder: value.trim() })); text.inputEl.setAttribute('aria-label', 'Routines folder'); });
    new Setting(general).setName('Time zone').setDesc('Used by Today and “now”, for example Europe/Berlin.')
      .addText(text => { text.inputEl.setAttribute('aria-label', 'Time zone'); text.setValue(settings.timezone).onChange(value => {
        try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); }
        catch { saveVersion++; saved.addClass('planner-error'); saved.setText('Invalid time zone. The last saved zone is still in use.'); return; }
        saveGeneral({ timezone: value });
      }); });
    general.appendChild(saved);
    entrySettings(section('entry', 'Activity entry', 'Applies to new entries; existing notes stay unchanged.'), c);
    reviewSettings(section('reports', 'Reports & markers', ''), c);
    this.clearProjects = projectSettings(section('projects', 'Projects & groups', ''), c);
    const maintenance = section('maintenance', 'Maintenance & recovery', '');
    new Setting(maintenance).setName('Rebuild index').setDesc('Refresh the note index. Disputed totals stay unchanged.')
      .addButton(button => { button.setButtonText('Rebuild index').onClick(() => actionFeedback(c, button.buttonEl, 'Rebuild index', () => rebuildResult(c))); });
    new Setting(maintenance).setName('Undo last operation').setDesc('Restore the last Planner change after checking for later manual edits.')
      .addButton(button => { button.setButtonText('Undo last operation').onClick(() => actionFeedback(c, button.buttonEl, 'Undo last operation', () => undoResult(c))); });
    new Setting(maintenance).setName('Pending summary updates').setDesc('Retry summary updates for edits already saved. Conflicting records stay protected.')
      .addButton(button => { button.setButtonText('Retry summary updates').onClick(() => actionFeedback(c, button.buttonEl, 'Retry summary updates', () => retryResult(c))); });
    quietSettingsLabels(this.containerEl);
  }
}
