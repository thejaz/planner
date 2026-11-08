import { Setting } from 'obsidian';
import type { Controller } from '../controller';
import { message } from './text';
import { singleEmojiField } from './emoji-field';
import { ManageProjectDialog, ProjectEmojiDialog, ProjectTransferDialog } from './dialogs';
import { actionFeedback, help, syncResult, openSettingsDialog, quietSettingsLabels } from './settings-feedback';

export function projectSettings(parent: HTMLElement, c: Controller): () => void {
  const root = parent.createDiv({ cls: 'planner-project-settings' });
  const tools = root.createDiv({ cls: 'planner-project-tools' });
  const search = tools.createEl('input', { type: 'search', placeholder: 'Search projects', attr: { 'aria-label': 'Search projects' } });
  const add = tools.createEl('form', { cls: 'planner-project-add-form' });
  const code = add.createEl('input', { type: 'text', placeholder: 'New code', attr: { 'aria-label': 'New project code' } });
  const emoji = singleEmojiField(add.createEl('input', { type: 'text', placeholder: 'Emoji (optional)', attr: { 'aria-label': 'New project emoji' } }));
  const submit = add.createEl('button', { type: 'submit', text: 'Add project' });
  const sync = tools.createEl('button', { text: 'Sync summaries' });
  help(sync, 'Add missing project definitions and update summary emojis.');
  tools.insertBefore(sync, add);
  const error = root.createDiv({ cls: 'planner-error', attr: { role: 'alert' } });
  const status = root.createDiv({ cls: 'planner-settings-status', attr: { role: 'status', 'aria-live': 'polite' } });
  const list = root.createDiv({ cls: 'planner-project-list' });
  const conflicts = root.createDiv({ cls: 'planner-emoji-conflicts' });
  const groups = root.createEl('details', { cls: 'planner-review-settings' });
  groups.createEl('summary', { text: 'Manage groups' });
  const groupList = groups.createDiv({ cls: 'planner-group-list' });
  const groupForm = groups.createEl('form', { cls: 'planner-project-add-form' });
  const groupName = groupForm.createEl('input', { type: 'text', placeholder: 'New group', attr: { 'aria-label': 'New group name' } });
  groupForm.createEl('button', { type: 'submit', text: 'Add group' });
  const save = async (action: () => Promise<void>) => { try { error.empty(); status.empty(); await action(); status.setText('Saved.'); } catch (e) { error.setText(message(e)); } };
  const paint = () => {
    const focused = root.ownerDocument.activeElement;
    const focusName = focused && root.contains(focused) ? focused.getAttribute('aria-label') ?? (focused as HTMLElement).dataset.plannerAccessibleName : null;
    list.empty(); groupList.empty(); conflicts.empty();
    if (c.issues.has('projects')) error.setText(c.issues.get('projects')!);
    for (const name of c.projectCodes().filter(value => value.toLowerCase().includes(search.value.trim().toLowerCase()))) {
      const row = list.createDiv({ cls: 'planner-project-setting-row' });
      const editEmoji = row.createEl('button', { text: c.settings.projectEmojis[name] ?? '+', attr: { 'aria-label': `Emoji for ${name}` } });
      editEmoji.onclick = () => openSettingsDialog(new ProjectEmojiDialog(c.app, c, name), editEmoji);
      help(editEmoji, 'Change project emoji');
      row.createEl('strong', { text: name });
      const select = row.createEl('select', { attr: { 'aria-label': `Group for ${name}` } });
      select.createEl('option', { value: '', text: 'Unassigned' });
      c.settings.projectGroups.forEach((g, i) => select.createEl('option', { value: String(i), text: g.name }));
      const index = c.settings.projectGroups.findIndex(g => g.projects.includes(name)); select.value = index < 0 ? '' : String(index);
      select.onchange = () => {
        const selected = select.value === '' ? -1 : Number(select.value);
        // Move the project into at most one group.
        void save(() => c.setReviewPreferences(settings => ({ projectGroups: settings.projectGroups.map((g, i) => ({
          ...g, projects: [...g.projects.filter(p => p !== name), ...(i === selected ? [name] : [])]
        })) })));
      };
      const actions = row.createDiv({ cls: 'planner-project-setting-actions' });
      const transfer = actions.createEl('button', { text: 'rename or merge', attr: { type: 'button', 'aria-label': `Rename or merge ${name}` } });
      transfer.onclick = () => openSettingsDialog(new ProjectTransferDialog(c.app, c, name), transfer);
      const remove = actions.createEl('button', { text: 'remove', attr: { 'aria-label': `Remove ${name}` } });
      remove.onclick = () => openSettingsDialog(new ManageProjectDialog(c.app, c, name), remove);
      help(remove, 'Preview removal; choose whether activities stay.');
    }
    for (const conflict of c.emojiConflicts()) {
      const row = conflicts.createDiv();
      row.createEl('p', { text: `${conflict.code}: summary ${conflict.emoji}, assigned ${conflict.assigned} (${conflict.path}:${conflict.line + 1})` });
      const source = row.createEl('button', { text: 'open source' }); source.onclick = () => { void c.openSource(conflict.path, conflict.line); };
      const adopt = row.createEl('button', { text: 'adopt summary emoji globally' }); adopt.onclick = () => { void save(() => c.resolveEmojiConflict(conflict, true)); };
      help(adopt, 'Use this emoji in project settings and all summaries.');
      const restore = row.createEl('button', { text: 'restore assigned emoji' }); restore.onclick = () => { void save(() => c.resolveEmojiConflict(conflict, false)); };
      help(restore, 'Use the assigned emoji in this summary.');
    }
    for (const [index, group] of c.settings.projectGroups.entries()) {
      let name = group.name;
      new Setting(groupList).setName(group.name).addText(text => { text.setValue(name).onChange(value => { name = value; }); text.inputEl.setAttribute('aria-label', `Rename ${group.name}`); })
        .addButton(button => { button.setButtonText('rename').onClick(() => { void save(async () => {
          name = name.trim(); if (!name || name.length > 80 || c.settings.projectGroups.some((g, i) => i !== index && g.name.toLowerCase() === name.toLowerCase())) throw new Error('Use a unique group name of 1-80 characters.');
          await c.setReviewPreferences({ projectGroups: c.settings.projectGroups.map((g, i) => i === index ? { ...g, name } : g) });
        }); }); })
        .addButton(button => { button.setButtonText('remove').onClick(() => { void save(() => c.setReviewPreferences({ projectGroups: c.settings.projectGroups.filter((_, i) => i !== index) })); }); help(button.buttonEl, 'Remove this group; keep its projects.'); });
    }
    quietSettingsLabels(root);
    if (focusName) for (const element of root.querySelectorAll<HTMLElement>('[data-planner-accessible-name]')) if (element.dataset.plannerAccessibleName === focusName) { element.focus(); break; }
  };
  add.onsubmit = event => {
    event.preventDefault(); if (submit.disabled) return;
    submit.disabled = true;
    void save(async () => { await c.addProjectCode(code.value, emoji.value); emoji.value = ''; code.value = ''; code.focus(); })
      .finally(() => { submit.disabled = false; });
  };
  sync.onclick = () => actionFeedback(c, sync, 'Sync project summaries', () => syncResult(c));
  groupForm.onsubmit = event => { event.preventDefault(); void save(async () => {
    const name = groupName.value.trim(); if (!name || name.length > 80 || c.settings.projectGroups.some(g => g.name.toLowerCase() === name.toLowerCase())) throw new Error('Use a unique group name of 1-80 characters.');
    await c.setReviewPreferences({ projectGroups: [...c.settings.projectGroups, { name, projects: [] }] }); groupName.value = '';
  }); };
  search.oninput = paint;
  const unsubscribe = c.onChange(paint); paint(); return unsubscribe;
}
