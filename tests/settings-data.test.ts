import { expect, it } from 'vitest';
import { dataRecord, stringItems } from '../src/core/settings-data';
import { normalizeGroups } from '../src/core/review-extras';

it('checks persisted JSON shapes before reading fields, retaining authored values', () => {
  for (const value of [null, undefined, 42, false, 'code', ['PRJ']]) expect(dataRecord(value)).toEqual({});
  const value = { projectCodes: ['PRJ', 1, null, 'MixedCase'], projectGroups: null, custom: 'preserve me' };
  expect(dataRecord(value)).toBe(value);
  expect(stringItems(value.projectCodes)).toEqual(['PRJ', 'MixedCase']);
  expect(value.projectCodes).toEqual(['PRJ', 1, null, 'MixedCase']);
  for (const malformed of [null, false, 1, {}, 'PRJ']) expect(stringItems(malformed)).toEqual([]);
});

it('normalizes malformed groups without trusting any array member', () => {
  const input = [null, [], false, { name: 4 }, { name: ' Study ', projects: ['prj', false, {}, 'OTHER'] },
    { name: 'Study', projects: ['DUP'] }, { name: 'Other', projects: ['PRJ', 'NEW'] }];
  const before = JSON.stringify(input);
  expect(normalizeGroups(input)).toEqual([{ name: 'Study', projects: ['PRJ', 'OTHER'] }, { name: 'Other', projects: ['NEW'] }]);
  expect(JSON.stringify(input)).toBe(before);
});
