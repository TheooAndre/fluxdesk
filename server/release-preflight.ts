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

/** Staged public release check. A live release retains Standard Protection for previews. */
export function socialReleasePreflight(input: unknown, phase: 'staging' | 'live' = 'staging') {
  const data = object(input), project = object(data.project), protection = object(project.ssoProtection);
  const blockers: string[] = [];
  if (project.id !== RELEASE_PROJECT || project.accountId !== RELEASE_TEAM || project.name !== 'fluxdesk')
    blockers.push('Project/team does not match FluxDesk.');
  const expected = phase === 'staging' ? 'all' : 'prod_deployment_urls_and_all_previews';
  if (protection.enabled !== true || protection.deploymentType !== expected)
    blockers.push(phase === 'staging' ? 'Keep all deployments protected during staging.' :
      'Use Standard Protection: public production domain, protected previews and deployment URLs.');
  if (!['22.x', '24.x'].includes(String(project.nodeVersion)))
    blockers.push('Verify the supported Node runtime.');
  if (!Array.isArray(data.envs) || data.hiddenProductionEnvCount !== 0)
    blockers.push('Complete environment metadata is required; hidden entries need review.');
  const envs = Array.isArray(data.envs) ? data.envs.map(object) : [];
  if (envs.some((e) => 'value' in e || 'decryptedValue' in e))
    blockers.push('Remove credential values from the input; supply metadata only.');
  const keys = ['FLUXDESK_BACKEND_URL', 'FLUXDESK_GATEWAY_TOKEN', 'FLUXDESK_PUBLIC_MODE',
    'VITE_FLUXDESK_PUBLIC_MODE', 'FLUXDESK_PUBLIC_HOST', 'FLUXDESK_SESSION_SECRET',
    'FLUXDESK_OWNER_SUB', 'FLUXDESK_DISCORD_CLIENT_ID', 'FLUXDESK_DISCORD_CLIENT_SECRET',
    'FLUXDESK_X_CLIENT_ID', 'FLUXDESK_X_CLIENT_SECRET'];
  const sensitive = new Set(['FLUXDESK_GATEWAY_TOKEN', 'FLUXDESK_SESSION_SECRET',
    'FLUXDESK_DISCORD_CLIENT_SECRET', 'FLUXDESK_X_CLIENT_SECRET']);
  for (const key of keys) {
    const matches = envs.filter((e) => e.key === key && Array.isArray(e.target) && e.target.includes('production'));
    if (matches.length !== 1) {
      blockers.push(`${key}: exactly one production configuration is required.`);
      continue;
    }
    const env = matches[0]!;
    if ((sensitive.has(key) && !['encrypted', 'sensitive'].includes(String(env.type))) ||
        (!sensitive.has(key) && !['plain', 'encrypted', 'sensitive'].includes(String(env.type))) ||
        env.gitBranch || (sensitive.has(key) && (env.target as unknown[]).some((t) => t !== 'production')))
      blockers.push(`${key}: invalid storage type, branch scope, or production-only secret target.`);
  }
  return { schemaVersion: 1, phase, configurationReady: blockers.length === 0, blockers,
    limitation: 'Metadata only: verify actual values, OAuth callbacks, owner mapping, backend isolation, preview protection, health, and durable data before opening the domain.' };
}

/** Password accounts do not require OAuth provider credentials. */
export function accountReleasePreflight(input: unknown, phase: 'staging' | 'live' = 'staging') {
  const data = object(input), project = object(data.project), protection = object(project.ssoProtection);
  const blockers: string[] = [];
  if (project.id !== RELEASE_PROJECT || project.accountId !== RELEASE_TEAM || project.name !== 'fluxdesk')
    blockers.push('Project/team does not match FluxDesk.');
  const scope = phase === 'staging' ? 'all' : 'prod_deployment_urls_and_all_previews';
  if (protection.enabled !== true || protection.deploymentType !== scope)
    blockers.push('Protect all URLs in staging; retain Standard Protection for generated URLs and previews when live.');
  if (!['22.x', '24.x'].includes(String(project.nodeVersion))) blockers.push('Verify the supported Node runtime.');
  if (!Array.isArray(data.envs) || data.hiddenProductionEnvCount !== 0)
    blockers.push('Complete environment metadata is required.');
  const envs = Array.isArray(data.envs) ? data.envs.map(object) : [];
  if (envs.some((env) => 'value' in env || 'decryptedValue' in env)) blockers.push('Remove credential values; metadata only.');
  for (const key of ['FLUXDESK_BACKEND_URL', 'FLUXDESK_GATEWAY_TOKEN', 'FLUXDESK_ACCOUNT_AUTH', 'VITE_FLUXDESK_PUBLIC_MODE', 'FLUXDESK_PUBLIC_HOST']) {
    const matches = envs.filter((env) => env.key === key && Array.isArray(env.target) && env.target.includes('production'));
    if (matches.length !== 1) { blockers.push(`${key}: exactly one production configuration is required.`); continue; }
    const env = matches[0]!;
    if (env.gitBranch || !['plain', 'encrypted', 'sensitive'].includes(String(env.type)) ||
        (key === 'FLUXDESK_GATEWAY_TOKEN' && env.type === 'plain') ||
        (['FLUXDESK_GATEWAY_TOKEN', 'FLUXDESK_ACCOUNT_AUTH', 'VITE_FLUXDESK_PUBLIC_MODE'].includes(key) &&
          (env.target as unknown[]).some((target) => target !== 'production')))
      blockers.push(`${key}: invalid scope or storage type.`);
  }
  return { schemaVersion: 1, phase, configurationReady: blockers.length === 0, blockers,
    limitation: 'Metadata only: verify accounts-v1 backend, persistent database, protected owner bootstrap, private-route denials, public reads and worker progress before opening the domain.' };
}
