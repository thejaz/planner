import type { App } from 'obsidian';

/** Open Obsidian Settings on Planner's tab. The settings modal is not in Obsidian's public typings. */
export function openPlannerSettings(app: App, id = 'thejaz-planner'): void {
  const setting = (app as App & { setting?: { open(): void; openTabById(id: string): void } }).setting;
  if (!setting) throw new Error('Open Planner settings from Settings > Community plugins.');
  setting.open(); setting.openTabById(id);
}
