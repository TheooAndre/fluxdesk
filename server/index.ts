import { createServer } from 'node:http';
import { handler } from './app.ts';
import { load } from './store.ts';
import { startLiquidations } from './liquidations.ts';
import { runAlertScanner } from './alerts.ts';
import { assertRemoteBindingAllowed } from './gateway.ts';
import { assertDurableDataDirectory } from './persistence.ts';
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);
assertRemoteBindingAllowed(host, {
  REVERSE_PROXY_OIDC: process.env.REVERSE_PROXY_OIDC,
  FLUXDESK_GATEWAY_TOKEN: process.env.FLUXDESK_GATEWAY_TOKEN,
});
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
// Never bring up an internet-reachable, stateful backend on ephemeral container
// storage. Fail closed unless DATA_DIR is an actual writable Linux mount.
if (!['127.0.0.1', '::1', 'localhost'].includes(host))
  await assertDurableDataDirectory();
await load();
startLiquidations();
runAlertScanner();
createServer((req, res) => {
  void handler(req, res);
}).listen(port, host, () => {
  console.info(`FluxDesk API listening on http://${host}:${port}`);
});
