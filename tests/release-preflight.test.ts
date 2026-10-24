import { expect, it } from 'vitest';
import { releasePreflight, RELEASE_PROJECT, RELEASE_TEAM } from '../server/release-preflight.ts';
const snapshot = () => ({
  project: {
    id: RELEASE_PROJECT,
    accountId: RELEASE_TEAM,
    name: 'fluxdesk',
    nodeVersion: '24.x',
    ssoProtection: { enabled: true, deploymentType: 'all' },
  },
  hiddenProductionEnvCount: 0,
  envs: ['FLUXDESK_BACKEND_URL', 'FLUXDESK_GATEWAY_TOKEN'].map((key) => ({
    key,
    target: ['production'],
    type: 'sensitive',
  })),
});
it('rejects actual preview-only scope while never treating metadata as promotion authorization', () => {
  const input = snapshot();
  input.envs.forEach((e) => (e.target = ['preview']));
  const result = releasePreflight(input);
  expect(result.configurationReady).toBe(false);
  expect(result.blockers).toHaveLength(2);
  expect(releasePreflight(snapshot()).configurationReady).toBe(true);
  expect(releasePreflight(snapshot()).limitation).toContain('Metadata only');
});
it('fails closed on missing, ambiguous, public, cross-environment and wrong-project configuration', () => {
  const cases: unknown[] = [null, {}, { ...snapshot(), hiddenProductionEnvCount: 1 }];
  const duplicate = snapshot();
  duplicate.envs.push(duplicate.envs[0]!);
  cases.push(duplicate);
  const publicEnv = snapshot();
  publicEnv.envs[1]!.type = 'plain';
  cases.push(publicEnv);
  const shared = snapshot();
  shared.envs[1]!.target.push('preview');
  cases.push(shared);
  const wrong = snapshot();
  wrong.project.id = 'other';
  cases.push(wrong);
  const protection = snapshot();
  protection.project.ssoProtection.deploymentType = 'preview';
  cases.push(protection);
  for (const input of cases) expect(releasePreflight(input).configurationReady).toBe(false);
});
it('never reflects input values or arbitrary attacker-supplied fields into reports', () => {
  const data = snapshot();
  Object.assign(data.envs[0]!, { value: 'DO-NOT-PRINT-THIS', decryptedValue: 'PRIVATE' });
  Object.assign(data.project, { id: 'SENSITIVE-INPUT', other: 'EXTRA' });
  const report = JSON.stringify(releasePreflight(data));
  for (const value of ['DO-NOT-PRINT-THIS', 'PRIVATE', 'SENSITIVE-INPUT', 'EXTRA'])
    expect(report).not.toContain(value);
  expect(releasePreflight(data).configurationReady).toBe(false);
});
