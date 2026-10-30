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
  const appLogin = data.authMode === 'app-password';
  if (appLogin) {
    if (data.appLoginVerified !== true) blockers.push('Verify the deployed app login before removing the Vercel wall.');
    if (protection.enabled !== true || !['all', 'prod_deployment_urls_and_all_previews'].includes(String(protection.deploymentType)))
      blockers.push('Keep Vercel Authentication on deployment URLs and previews.');
  } else if (protection.enabled !== true || protection.deploymentType !== 'all')
    blockers.push('Vercel Authentication must cover all deployments.');
  if (!['22.x', '24.x'].includes(String(project.nodeVersion)))
    blockers.push('Verify the supported Node runtime.');
  if (!Array.isArray(data.envs) || data.hiddenProductionEnvCount !== 0)
    blockers.push('Complete environment metadata is required; hidden entries need review.');
  const envs = Array.isArray(data.envs) ? data.envs.map(object) : [];
  if (envs.some((e) => 'value' in e || 'decryptedValue' in e))
    blockers.push('Remove credential values from the input; supply metadata only.');
  const requiredKeys: readonly string[] = appLogin ? [...required, 'FLUXDESK_APP_PASSWORD', 'VITE_FLUXDESK_APP_LOGIN'] : required;
  for (const key of requiredKeys) {
    const matches = envs.filter(
      (e) => e.key === key && Array.isArray(e.target) && e.target.includes('production'),
    );
    if (matches.length !== 1) blockers.push(`${key}: exactly one production configuration is required.`);
    else {
      const env = matches[0]!;
      const allowedTypes =
        ['FLUXDESK_GATEWAY_TOKEN', 'FLUXDESK_APP_PASSWORD'].includes(key) ? ['encrypted', 'sensitive'] : ['plain', 'encrypted', 'sensitive'];
      if (!allowedTypes.includes(String(env.type)) || env.gitBranch)
        blockers.push(`${key}: production configuration has an invalid storage type or branch scope.`);
      if (['FLUXDESK_GATEWAY_TOKEN', 'FLUXDESK_APP_PASSWORD'].includes(key) && (env.target as unknown[]).some((t) => t !== 'production'))
        blockers.push('Production credentials must have their own production-only scope.');
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
