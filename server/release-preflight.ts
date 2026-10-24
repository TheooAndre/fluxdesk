// Metadata-only configuration check. It never reads credential values or calls providers.
export const RELEASE_PROJECT = 'prj_bIcLfAUtJLclq1WlTPgSbAehGQQt';
export const RELEASE_TEAM = 'team_U2UbL7K29gQw1oTuG6hIJe2d';
const required = ['FLUXDESK_BACKEND_URL', 'FLUXDESK_GATEWAY_TOKEN'] as const;
function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function releasePreflight(input: unknown) {
  const data = object(input),
    project = object(data.project),
    protection = object(project.ssoProtection);
  const blockers: string[] = [];
  if (project.id !== RELEASE_PROJECT || project.accountId !== RELEASE_TEAM || project.name !== 'fluxdesk')
    blockers.push('Project/team does not match FluxDesk.');
  if (protection.enabled !== true || protection.deploymentType !== 'all')
    blockers.push('Vercel Authentication must cover all deployments.');
  if (!['22.x', '24.x'].includes(String(project.nodeVersion)))
    blockers.push('Verify the supported Node runtime.');
  if (!Array.isArray(data.envs) || data.hiddenProductionEnvCount !== 0)
    blockers.push('Complete environment metadata is required; hidden entries need review.');
  const envs = Array.isArray(data.envs) ? data.envs.map(object) : [];
  if (envs.some((e) => 'value' in e || 'decryptedValue' in e))
    blockers.push('Remove credential values from the input; supply metadata only.');
  for (const key of required) {
    const matches = envs.filter(
      (e) => e.key === key && Array.isArray(e.target) && e.target.includes('production'),
    );
    if (matches.length !== 1) blockers.push(`${key}: exactly one production configuration is required.`);
    else {
      const env = matches[0]!;
      const allowedTypes =
        key === 'FLUXDESK_GATEWAY_TOKEN' ? ['encrypted', 'sensitive'] : ['plain', 'encrypted', 'sensitive'];
      if (!allowedTypes.includes(String(env.type)) || env.gitBranch)
        blockers.push(`${key}: production configuration has an invalid storage type or branch scope.`);
      if (key === 'FLUXDESK_GATEWAY_TOKEN' && (env.target as unknown[]).some((t) => t !== 'production'))
        blockers.push('Production gateway credential must have its own production-only scope.');
    }
  }
  return {
    schemaVersion: 1,
    configurationReady: blockers.length === 0,
    blockers,
    limitation:
      'Metadata only: does not verify credential contents, backend isolation, health, data durability, or authorize promotion.',
  };
}
