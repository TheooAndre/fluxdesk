import { expect, test } from 'vitest';
import { money } from '../src/lib/format.ts';

// Node 22 and Chromium differ in their implicit currency precision when using
// compact notation. Explicit precision keeps prerendered text hydratable.
test.each([
  [0, '$0'],
  [12.5, '$12.5'],
  [1000, '$1K'],
  [1250000, '$1.25M'],
  [-1250000, '-$1.25M'],
  [NaN, '—'],
] as const)('formats compact money %s consistently', (value, expected) => {
  expect(money(value)).toBe(expected);
});
test('standard currency retains cents and optional additional precision', () => {
  expect(money(0, false)).toBe('$0.00');
  expect(money(12.3456, false)).toBe('$12.3456');
});
