import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = (name: string) => readFile(new URL('../deploy/vps/' + name, import.meta.url), 'utf8');

describe('provider-neutral, self-hosted backend security', () => {
  it('routes external traffic through TLS and never exposes the API port', async () => {
    const compose = await read('compose.yaml');
    const caddy = await read('Caddyfile');
    expect(compose).toContain('FLUXDESK_GATEWAY_TOKEN: ${FLUXDESK_GATEWAY_TOKEN:?');
    expect(compose).toContain('FLUXDESK_BACKEND_DOMAIN: ${FLUXDESK_BACKEND_DOMAIN:?');
    expect(compose).toContain('"80:80"');
    expect(compose).toContain('"443:443"');
    expect(compose).toContain('"8787"');
    expect(compose).not.toMatch(/-\s*["']?(?:0\.0\.0\.0:)?8787:8787/);
    expect(compose).toContain('research-data:/data');
    expect(compose).toContain('name: fluxdesk_backend_data');
    expect(compose).toContain('no-new-privileges:true');
    expect(compose).toContain('service_healthy');
    expect(caddy).toContain('{$FLUXDESK_BACKEND_DOMAIN}');
    expect(caddy).toContain('reverse_proxy api:8787');
  });
  it('keeps the environment example free of real production credentials', async () => {
    const sample = await read('.env.example');
    expect(sample).toMatch(/FLUXDESK_GATEWAY_TOKEN=replace-with-/);
    expect(sample).not.toContain('VITE_FLUXDESK_GATEWAY_TOKEN');
    expect(sample).toContain('FLUXDESK_BACKEND_DOMAIN');
    const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
    expect(gitignore).toMatch(/(?:^|\n)\.env(?:\n|$)/);
  });
  it('backup archive enforces file permissions and never reads app credentials', async () => {
    const backup = await read('backup.sh');
    expect(backup).toContain('chmod 700');
    expect(backup).toContain('umask 077');
    expect(backup).toContain('chmod 600');
    expect(backup).toContain('readonly');
    expect(backup).toContain('tar -tzf');
    expect(backup).not.toContain('FLUXDESK_GATEWAY_TOKEN');
  });
});
