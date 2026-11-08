/** Treat persisted JSON as untrusted data until its fields have been checked. */
export function dataRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function stringItems(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === 'string') : [];
}
