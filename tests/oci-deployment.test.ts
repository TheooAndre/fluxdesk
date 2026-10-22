import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const read = async (path: string) =>
  readFile(new URL('../deploy/oci/' + path, import.meta.url), 'utf8');

describe('Oracle Always Free attached-volume deployment', () => {
  it('binds the named Docker dataset volume to a separate OCI host mount', async () => {
    const file = await read('compose.oci.yaml');
    expect(file).toContain('research-data:');
    expect(file).toContain('name: fluxdesk_backend_data');
    expect(file).toContain('driver: local');
    expect(file).toContain('type: none');
    expect(file).toContain('o: bind');
    expect(file).toContain('device: /srv/fluxdesk/data');
    expect(file).not.toMatch(/^\s*ports:/m);
  });

  it('fails closed if the OCI attached block disk is not mounted at boot', async () => {
    const script = await read('verify-host.sh');
    expect(script).toContain('mountpoint -q "$MOUNT"');
    expect(script).toContain('findmnt --fstab --mountpoint "$MOUNT"');
    expect(script).toContain('stat -c');
    expect(script).toContain('1000:1000');
    expect(script).toContain('sudo docker volume inspect');
    expect(script).toContain('FLUXDESK_GATEWAY_TOKEN');
    expect(script).not.toMatch(/^\s*(?:mkfs|wipefs|parted|dd|docker\s+volume\s+rm)\b/m);
    expect(script).toContain('No disks formatted; no containers deployed.');
  });

  it('documents free-tier limits, nonpublic API and safe disk identification', async () => {
    const doc = await readFile(new URL('../docs/oci-always-free-v0.4.md', import.meta.url), 'utf8');
    expect(doc).toContain('VM.Standard.A1.Flex');
    expect(doc).toContain('1 OCPU, 6 GB');
    expect(doc).toContain('50 GB');
    expect(doc).toContain('200 GB');
    expect(doc).toContain('Do **not** allow ingress on **8787**');
    expect(doc).toContain('Never assume the device is /dev/sdb');
    expect(doc).toContain('deploy/oci/compose.oci.yaml');
    expect(doc).toContain('deploy/oci/verify-host.sh');
  });
});
