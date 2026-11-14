import { expect, it } from 'vitest';
import { deliveryLabel, technicalHealth } from '../src/lib/alert-health.ts';
import type { AlertRule, AlertEvent } from '../src/types.ts';
it('distinguishes never checked, delayed, failed and invalid-future scan observations', () => {
  const now = 1000_000;
  const rule = {
    kind: 'technical',
    assetIds: ['a', 'b', 'c', 'd'],
    technicalState: {
      a: { evaluatedAt: now - 180_000 },
      b: { evaluatedAt: now - 1000, error: 'Unavailable' },
      d: { evaluatedAt: now + 1000 },
    },
  } as unknown as Extract<AlertRule, { kind: 'technical' }>;
  expect(technicalHealth(rule, now)).toEqual({ unchecked: 2, delayed: 1, failed: 1, oldest: now - 180_000 });
});
it('never calls an accepted push a device receipt', () => {
  const event = { delivery: { devices: [{ status: 'accepted' }] } } as unknown as AlertEvent;
  expect(deliveryLabel(event)).toBe('Push service accepted · 1 device');
  expect(deliveryLabel({} as AlertEvent)).toBe('Delivery not tracked');
  expect(deliveryLabel({ delivery: { devices: [] } } as unknown as AlertEvent)).toBe('No push devices');
});
