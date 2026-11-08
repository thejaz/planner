import { Setting } from 'obsidian';
import type { Controller } from '../controller';
import { message } from './text';
import { validateEntryDefaults } from '../core/entry-defaults';
import { DEFAULT_ACTIVITY_HELPERS, parseHelperList } from '../core/activity-helpers';
import { actionFeedback, help } from './settings-feedback';

export function entrySettings(parent: HTMLElement, controller: Controller): void {
  const section = parent.createDiv({ cls: 'planner-entry-settings' });
  const defaults = section.createDiv({ cls: 'planner-entry-defaults' });
  const draft = { defaultBlockMinutes: controller.settings.defaultBlockMinutes, defaultStartTime: controller.settings.defaultStartTime,
    defaultStartActivity: controller.settings.defaultStartActivity };
  new Setting(defaults).setName('Default block').setDesc('Minutes added when you enter only an activity name.')
    .addText(text => {
      text.setValue(String(draft.defaultBlockMinutes)).onChange(value => { draft.defaultBlockMinutes = value.trim() ? Number(value) : NaN; });
      text.inputEl.type = 'number'; text.inputEl.setAttribute('aria-label', 'Default block minutes');
    });
  new Setting(defaults).setName('Default start time').setDesc('First endpoint for an empty plan.')
    .addText(text => { text.setValue(draft.defaultStartTime).onChange(value => { draft.defaultStartTime = value; }); text.inputEl.type = 'time'; text.inputEl.setAttribute('aria-label', 'Default start time'); });
  new Setting(defaults).setName('Default start activity').setDesc('Inserted unchecked with n/a duration.')
    .addText(text => { text.setValue(draft.defaultStartActivity).onChange(value => { draft.defaultStartActivity = value; }); text.inputEl.setAttribute('aria-label', 'Default start activity'); });
  const saveRow = new Setting(defaults);
  const defaultsStatus = saveRow.controlEl.createSpan({ cls: 'planner-settings-status', attr: { role: 'status', 'aria-live': 'polite' } });
  saveRow.addButton(button => button.setButtonText('Save entry defaults').onClick(async () => {
    if (button.buttonEl.disabled) return;
    button.setDisabled(true); defaultsStatus.removeClass('planner-error'); defaultsStatus.setText('Saving…');
    try {
      validateEntryDefaults(draft);
      const saved = { ...draft, defaultStartActivity: draft.defaultStartActivity.trim() };
      await controller.setEntryDefaults(saved); defaultsStatus.setText('Entry defaults saved.');
    } catch (error) { defaultsStatus.addClass('planner-error'); defaultsStatus.setText(message(error)); }
    finally { button.setDisabled(false); }
  }));
  const round = (name: string, desc: string, key: 'roundTimes' | 'roundCredits') => new Setting(section).setName(name).setDesc(desc)
    .addToggle(toggle => toggle.setValue(controller.settings[key]).onChange(value => {
      void controller.updateSettings({ [key]: value }).then(() => status.setText('Saved.')).catch(error => status.setText(message(error)));
    }));
  round('Round entered times', 'Round new times to the nearest 5 minutes. Calculated credit stays within the actual elapsed block.', 'roundTimes');
  round('Round credited minutes', 'Round allocations together in 5-minute units without exceeding elapsed time. Explicit over-credit is preserved.', 'roundCredits');
  // Activity helpers: one comma-separated list; project codes are offered automatically.
  let helpers: HTMLInputElement | undefined;
  const saveHelpers = (names: string[]) => { void controller.updateSettings({ activityHelpers: names }).then(() => status.setText('Activity helpers saved.')).catch(error => status.setText(message(error))); };
  new Setting(section).setName('Activity helpers')
    .setDesc('Activity names offered while you type, separated by commas. Project codes are added automatically.')
    .addText(text => {
      helpers = text.inputEl;
      text.setValue(controller.settings.activityHelpers.join(', ')).onChange(value => saveHelpers(parseHelperList(value)));
      text.inputEl.setAttribute('aria-label', 'Activity helpers'); text.inputEl.addClass('planner-helpers-input');
    })
    .addButton(button => {
      button.setButtonText('Restore helper defaults').onClick(() => actionFeedback(controller, button.buttonEl, 'Restore activity helpers', async () => {
        if (JSON.stringify(controller.settings.activityHelpers) === JSON.stringify(DEFAULT_ACTIVITY_HELPERS)) return { outcome: 'unchanged', message: 'Default activity helpers are already in use.' };
        await controller.updateSettings({ activityHelpers: [...DEFAULT_ACTIVITY_HELPERS] });
        if (helpers) helpers.value = DEFAULT_ACTIVITY_HELPERS.join(', ');
        return { message: 'Default activity helpers restored.', details: ['Entry defaults and notes are unchanged.'] };
      }));
      help(button.buttonEl, 'Reset the suggestion list only.');
    });
  const status = section.createEl('p', { cls: 'planner-settings-status', attr: { role: 'status', 'aria-live': 'polite' } });
}
