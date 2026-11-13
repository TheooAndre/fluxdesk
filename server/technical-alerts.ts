import type { AlertRule, Market } from '../src/types.ts';
import { evaluateTechnicalCondition } from '../src/engine/technical-alerts.ts';
import { candles } from './market.ts';
import { deliver } from './notifications.ts';
import { recordTechnicalEvaluations, type TechnicalEvaluation } from './store.ts';

type TechnicalRule = Extract<AlertRule, { kind: 'technical' }>;
/** Bounded, oldest-first work prevents a large basket from monopolizing the market worker. */
export async function scanTechnicalAlerts(rules: TechnicalRule[], markets: Market[]) {
  if (!rules.length) return;
  const deadline = Date.now() + 40_000;
  const marketById = new Map(markets.map((m) => [m.id, m]));
  const history = new Map<string, Promise<Awaited<ReturnType<typeof candles>>>>();
  let active = 0;
  const waiting: (() => void)[] = [];
  const getSeries = (assetId: string, timeframe: string) => {
    const key = `${assetId}:${timeframe}`;
    const hit = history.get(key);
    if (hit) return hit;
    const task = (async () => {
      if (active >= 4) await new Promise<void>((resolve) => waiting.push(resolve));
      else active++;
      try {
        if (Date.now() > deadline) throw Error('Advanced alert work queued');
        return await candles(assetId, timeframe, 300);
      } finally {
        const next = waiting.shift();
        if (next) next();
        else active--;
      }
    })();
    history.set(key, task);
    return task;
  };
  const jobs = rules
    .flatMap((rule) =>
      rule.assetIds.map((assetId) => ({
        rule,
        assetId,
        checkedAt: rule.technicalState?.[assetId]?.evaluatedAt ?? 0,
      })),
    )
    .sort((a, b) => a.checkedAt - b.checkedAt || a.rule.createdAt - b.rule.createdAt);
  const results = new Map<string, TechnicalEvaluation[]>();
  const selected: typeof jobs = [];
  const allocated = new Set<string>();
  for (const job of jobs) {
    const required = [...new Set(job.rule.conditions.map((c) => `${job.assetId}:${c.timeframe}`))];
    if (new Set([...allocated, ...required]).size > 40 || selected.length >= 80) continue;
    required.forEach((key) => allocated.add(key));
    selected.push(job);
  }
  let cursor = 0;
  async function work() {
    while (cursor < selected.length && Date.now() <= deadline) {
      const job = selected[cursor++]!;
      const { rule, assetId } = job;
      let evaluation: TechnicalEvaluation;
      try {
        const asset = marketById.get(assetId);
        if (
          !asset ||
          !Number.isFinite(asset.price) ||
          asset.price <= 0 ||
          !Number.isFinite(asset.asOf) ||
          asset.asOf > Date.now() ||
          Date.now() - asset.asOf > 120_000
        )
          throw Error('Live market data unavailable');
        const signals = await Promise.all(
          rule.conditions.map(async (condition) => {
            const bars = await getSeries(assetId, condition.timeframe);
            return evaluateTechnicalCondition(condition, bars);
          }),
        );
        const matched =
          rule.match === 'all' ? signals.every((s) => s.matched) : signals.some((s) => s.matched);
        const eventSignals = signals
          .map((s, i) => (s.matched && s.event ? `${i}:${s.barTime}` : ''))
          .filter(Boolean);
        evaluation = {
          assetId,
          key: signals.map((s) => s.barTime).join(':'),
          matched,
          ...(eventSignals.length ? { eventKey: eventSignals.join(':') } : {}),
          message: `${asset.symbol} · ${rule.name}: ${signals
            .filter((s) => s.matched)
            .map((s) => s.detail)
            .join(' + ')}. Closed candle${signals.length > 1 ? 's' : ''}.`,
        };
      } catch (error) {
        // Queued work keeps its old check time and is prioritized on the next scan.
        if (error instanceof Error && error.message === 'Advanced alert work queued') continue;
        evaluation = {
          assetId,
          error: error instanceof Error ? error.message : 'Indicator data unavailable',
        };
      }
      const group = results.get(rule.id) ?? [];
      group.push(evaluation);
      results.set(rule.id, group);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, work));
  for (const [ruleId, evaluations] of results) {
    try {
      const events = await recordTechnicalEvaluations(ruleId, evaluations);
      for (const event of events) await deliver(event);
    } catch (error) {
      console.error('Advanced alert persistence or delivery failure', ruleId, error);
    }
  }
}
