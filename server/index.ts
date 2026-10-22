import { createServer } from 'node:http';
import { handler } from './app.ts';
import { load } from './store.ts';
import { startLiquidations } from './liquidations.ts';
import { runAlertScanner } from './alerts.ts';
import { assertRemoteBindingAllowed } from './gateway.ts';
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 8787);
assertRemoteBindingAllowed(host, process.env);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw Error('Invalid PORT');
await load();
startLiquidations();
runAlertScanner();
createServer((req, res) => {
  void handler(req, res);
}).listen(port, host, () => {
  console.info(`FluxDesk API listening on http://${host}:${port}`);
});
