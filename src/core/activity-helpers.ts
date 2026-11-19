/** Reusable activity names offered while typing; project codes are added automatically. */
export const DEFAULT_ACTIVITY_HELPERS = ['break', 'free', 'buffer', 'setup', 'awake', 'lunch', 'dinner', 'breakfast', 'procrastination'];

/** Upgrade only the unchanged previous defaults; custom lists, including empty ones, stay intact. */
export function upgradedHelpers(value: unknown, upgraded: boolean): string[] {
  const names = normalizeHelpers(value), previous = DEFAULT_ACTIVITY_HELPERS.slice(0, -1);
  return !upgraded && names.length === previous.length && names.every((name, i) => name === previous[i])
    ? [...DEFAULT_ACTIVITY_HELPERS] : names;
}

/** Lowercase, single-line, unique names; anything else is dropped. */
export function normalizeHelpers(value: unknown): string[] {
  if (!Array.isArray(value)) return [...DEFAULT_ACTIVITY_HELPERS];
  const names = value.filter((name): name is string => typeof name === 'string')
    .map(name => name.trim().toLowerCase()).filter(name => name && name.length <= 40 && !/[;\r\n]/.test(name));
  return [...new Set(names)];
}
/** Settings text: names separated by commas. */
export function parseHelperList(text: string): string[] { return normalizeHelpers(text.split(',')); }
/** Configured helpers first, then project codes in lowercase, without repeats. */
export function activityHelpers(configured: string[], projectCodes: string[]): string[] {
  return [...new Set([...configured, ...projectCodes.map(code => code.toLowerCase())])];
}
/** Names containing the query, those starting with it first. */
export function matchHelpers(helpers: string[], query: string, limit = 12): string[] {
  const q = query.trim().toLowerCase();
  return helpers.filter(name => name.includes(q))
    .sort((a, b) => Number(b.startsWith(q)) - Number(a.startsWith(q))).slice(0, limit);
}
