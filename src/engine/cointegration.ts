/** Log-OLS Engle–Granger residual ADF(1), no constant in residual regression.
 * MacKinnon (2010) N=2, constant-first-stage critical values; see docs/statarb-scanner.md.
 * Fixed lag for bounded venue-wide discovery; original research uses BIC up to lag 6.
 */
export type CointegrationResult = {
  beta: number;
  intercept: number;
  adf: number;
  critical10: number;
  critical5: number;
  critical1: number;
  level: '1%' | '5%' | '10%' | 'none';
  z: number;
  halfLife: number | null;
  betaDrift: number;
  sample: number;
  lastSpread: number;
  spreadMean: number;
  spreadSd: number;
};
const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / x.length;
export function logFit(y: number[], x: number[]) {
  const mx = mean(x),
    my = mean(y);
  let xx = 0,
    xy = 0;
  for (let i = 0; i < x.length; i++) {
    xx += (x[i]! - mx) ** 2;
    xy += (x[i]! - mx) * (y[i]! - my);
  }
  if (xx < 1e-12) throw Error('Degenerate price history');
  const beta = xy / xx;
  return { beta, intercept: my - beta * mx };
}
export function residualAdf1(e: number[]) {
  let aa = 0,
    ab = 0,
    bb = 0,
    ay = 0,
    by = 0;
  const rows: { a: number; b: number; y: number }[] = [];
  for (let i = 2; i < e.length; i++) {
    const a = e[i - 1]!,
      b = e[i - 1]! - e[i - 2]!,
      y = e[i]! - e[i - 1]!;
    aa += a * a;
    ab += a * b;
    bb += b * b;
    ay += a * y;
    by += b * y;
    rows.push({ a, b, y });
  }
  const det = aa * bb - ab * ab;
  if (det < 1e-24 || rows.length < 20) throw Error('Degenerate residual regression');
  const gamma = (bb * ay - ab * by) / det,
    delta = (aa * by - ab * ay) / det;
  let ss = 0;
  for (const r of rows) ss += (r.y - gamma * r.a - delta * r.b) ** 2;
  const se = Math.sqrt(((ss / (rows.length - 2)) * bb) / det);
  if (se < 1e-12) throw Error('Near-identical contracts: residual variance too small');
  return gamma / se;
}
export function cointegration(yPrices: number[], xPrices: number[]): CointegrationResult {
  if (
    yPrices.length !== xPrices.length ||
    yPrices.length < 181 ||
    ![...yPrices, ...xPrices].every((p) => Number.isFinite(p) && p > 0)
  )
    throw Error('At least 180 formation bars plus one signal bar required');
  const y = yPrices.map(Math.log),
    x = xPrices.map(Math.log),
    fy = y.slice(0, -1),
    fx = x.slice(0, -1),
    fit = logFit(fy, fx);
  if (fit.beta <= 0) throw Error('Positive hedge ratio required for a long/short pair');
  const residual = fy.map((p, i) => p - fit.intercept - fit.beta * fx[i]!);
  const adf = residualAdf1(residual);
  const n = fy.length - 1;
  const cv = (a: number, b: number, c: number) => a + b / n + c / n ** 2;
  const critical1 = cv(-3.89644, -10.9519, -33.527),
    critical5 = cv(-3.33613, -6.1101, -6.823),
    critical10 = cv(-3.04445, -4.2412, -2.72);
  const spread = y.slice(-90).map((p, i) => p - fit.intercept - fit.beta * x[x.length - 90 + i]!);
  const spreadMean = mean(spread),
    spreadSd = Math.sqrt(spread.reduce((s, p) => s + (p - spreadMean) ** 2, 0) / (spread.length - 1));
  if (spreadSd < 1e-10) throw Error('Degenerate spread');
  const lag = residual.slice(0, -1),
    next = residual.slice(1),
    rho = logFit(next, lag).beta;
  const mid = Math.floor(fy.length / 2),
    b1 = logFit(fy.slice(0, mid), fx.slice(0, mid)).beta,
    b2 = logFit(fy.slice(mid), fx.slice(mid)).beta;
  return {
    ...fit,
    adf,
    critical1,
    critical5,
    critical10,
    level: adf <= critical1 ? '1%' : adf <= critical5 ? '5%' : adf <= critical10 ? '10%' : 'none',
    z: (spread.at(-1)! - spreadMean) / spreadSd,
    halfLife: rho > 0 && rho < 1 ? -Math.log(2) / Math.log(rho) : null,
    betaDrift: Math.abs(b1 - b2) / Math.max(Math.abs(fit.beta), 1e-9),
    sample: fy.length,
    lastSpread: spread.at(-1)!,
    spreadMean,
    spreadSd,
  };
}
