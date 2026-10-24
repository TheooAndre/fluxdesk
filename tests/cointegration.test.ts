import { it, expect } from 'vitest';
import reference from './fixtures/cointegration-reference.json';
import { cointegration, residualAdf1 } from '../src/engine/cointegration.ts';
for (const c of reference.cases)
  it('matches independent statsmodels reference: ' + c.name, () => {
    const result = cointegration(c.y, c.x);
    for (const key of ['beta', 'intercept', 'adf', 'critical1', 'critical5', 'critical10', 'z'] as const)
      expect(result[key]).toBeCloseTo(c.expected[key], 6);
    if (c.name === 'cointegrated') {
      expect(result.level).toBe('1%');
      expect(result.z).toBeGreaterThan(2);
    } else
      expect(result.level).toBe(
        '5%',
      ); /* This random-walk fixture is a nominal false positive, also found by statsmodels. */
  });
it('rejects identical, constant, incomplete and invalid histories', () => {
  expect(() => cointegration(Array(301).fill(100), Array(301).fill(100))).toThrow();
  expect(() => residualAdf1(Array(300).fill(0))).toThrow();
  expect(() => cointegration([1, 2], [2, 3])).toThrow();
  expect(() =>
    cointegration(
      reference.cases[0]!.y.map((v, i) => (i === 10 ? NaN : v)),
      reference.cases[0]!.x,
    ),
  ).toThrow();
});
it('uses only formation bars to fit beta; latest bar changes z but not fit or EG test', () => {
  const c = reference.cases[0]!,
    before = cointegration(c.y, c.x);
  const y = [...c.y];
  y[y.length - 1] = y.at(-1)! * 1.2;
  const after = cointegration(y, c.x);
  expect(after.beta).toBe(before.beta);
  expect(after.adf).toBe(before.adf);
  expect(after.z).not.toBe(before.z);
});
