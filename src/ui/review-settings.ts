import { Setting } from 'obsidian';
import type { Controller } from '../controller';
import { message } from './text';
import { CRITERIA_NOTE } from '../core/criteria';

export function reviewSettings(parent: HTMLElement, c: Controller): void {
  const markers = parent.createDiv({ cls: 'planner-marker-settings' });
  const markerError = markers.createDiv({ cls: 'planner-error', attr: { role: 'alert' } });
  const update = async (changes: Parameters<Controller['setReviewPreferences']>[0]) => {
    try { await c.setReviewPreferences(changes); markerError.empty(); }
    catch (e) { markerError.setText(message(e)); }
  };
  new Setting(markers).setName('Show day marker counts').setDesc('Count saved markers in the selected report dates.')
    .addToggle(toggle => toggle.setValue(c.settings.showMarkerCounts).onChange(value => { void update({ showMarkerCounts: value }); }));
  new Setting(markers).setName('Criteria & Markers note').setDesc(`Shared rules: ${CRITERIA_NOTE}. Without it, built-in ranges apply and custom contexts are unavailable.`);
  const weekend = new Setting(markers).setName('Weekend days').setDesc('Used for weekend markers and bold dates in future summary updates.');
  weekend.settingEl.addClass('planner-weekend-setting');
  weekend.controlEl.addClass('planner-weekend-days');
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  for (const day of [1, 2, 3, 4, 5, 6, 0]) {
    const name = names[day]!;
    const label = weekend.controlEl.createEl('label', { cls: 'planner-weekend-option' });
    const input = label.createEl('input', { type: 'checkbox' }); input.checked = c.settings.weekendDays.includes(day);
    input.dataset.weekendDay = String(day);
    label.appendText(name.slice(0, 3)); input.setAttribute('aria-label', `${name} is a weekend`);
    input.onchange = () => { void update({ weekendDays: [...weekend.controlEl.querySelectorAll<HTMLInputElement>('input[data-weekend-day]:checked')].map(item => Number(item.dataset.weekendDay)) }); };
  }
}
