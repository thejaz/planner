// Native helpers define day-marker criteria in thejaz-criteria.md at the test vault root,
// the one note every summary uses. Pass null to remove it (built-in minute ranges apply).
export const CRITERIA_NOTE = 'thejaz-criteria.md';
export async function setCriteria(page, text) {
  await page.evaluate(async ({ note, text }) => {
    const c = app.plugins.plugins['thejaz-planner'].controller, file = app.vault.getAbstractFileByPath(note);
    if (text === null) { if (file) await app.vault.delete(file); c.remove(note); return; }
    if (file) await app.vault.modify(file, text); else await app.vault.create(note, text);
    c.ingest(note, text);
  }, { note: CRITERIA_NOTE, text });
}
