# Crypto stat-arb in Correlation Lab

The original protocol remains under **Stat-arb scanner → Show original research protocol**. The new venue-wide live discovery scanner is documented in [scanner method](statarb-scanner.md). The preserved research view incorporates the owner's 19 October 2026 research package. It preserves the preregistered cointegrated-pairs strategy, original source, validation report and paper runbook. **No tradable edge has been established.** The original package contains synthetic experiments and engineering tests, not validated crypto market results.

## Terminal behavior

The existing correlation scanner remains a descriptive tool. Its 80-bar rolling hedge, z-score and Pearson correlation are not Engle–Granger results and are never treated as entry signals for this strategy.

The new workspace shows the hypothesis, exact original defaults, long/short convention, risk rules, missing data and validation gates. The optional original synthetic demo is explicitly labelled and includes every development fold, including no-pair/no-trade folds. It does not open or display an invented market holdout.

The report viewer imports a bounded JSON export **on the device only**. It neither uploads nor persists reports; leaving the workspace or reloading clears them. Keep source results separately. All imported claims and figures remain unverified, even when they assert complete funding/PIT coverage. Imports cannot authorize trading. Version/schema, finite metrics, hashes, chronological nonoverlapping folds and holdout consistency are checked. Import validation is not independent statistical verification.

## Offline research engine

Python is deliberately separate from the hosted Node API and its 0.1 CPU / 256 MiB instance. No paid worker, runtime change or exchange order integration is added. Code and documentation are under `research/statarb`; see its provenance record for the original archive SHA-256. Unsafe legacy code and generated binary plots are omitted.

From the repository root:

```bash
python3 -m venv .venv-statarb
. .venv-statarb/bin/activate
pip install -r research/statarb/requirements-validation.txt
pip install --no-deps -e research/statarb
python -m pytest research/statarb/tests -q
statarb research --data /path/to/historical_export --out reports/real
python research/statarb/export_terminal.py reports/real terminal-report.json
```

Choose **Import stat-arb JSON** in the terminal to inspect the export. The exporter is standard-library only, reads existing reports, refuses output overwrite, and never runs research or opens the holdout. It requires existing complete result files, not candles alone.

For a mechanical plumbing check only:

```bash
statarb demo --out reports/demo
python research/statarb/export_terminal.py reports/demo synthetic-report.json
```

Both commands produce **synthetic results**, with no empirical market inference. The bundled terminal demo was exported from the original archive, not rerun or selected for favorable metrics.

## Before market validation

Read the preserved [research memo](../research/statarb/RESEARCH_MEMO.md), [input contract](../research/statarb/README.md), [validation report](../research/statarb/VALIDATION_REPORT.md) and [paper runbook](../research/statarb/PAPER_RUNBOOK.md).

Required inputs include 2+ years of same-venue 4h OHLCV, realized timestamped funding on both legs, point-in-time membership including delistings, and historical USD volume and OI snapshots. A vendor's coverage assertion must be audited. Current market snapshots and Strategy Lab's short OHLCV archive do not satisfy this contract. Fees must reflect the owner's account tier; slippage still needs fill/book validation.

Freeze the hypothesis, configuration, complete trial history and dataset hash before evaluating market development. Use nonoverlapping walk-forward folds; preserve every failed/empty fold and every attempted variant. Only after freezing the experiment should the final chronological 30% holdout be opened, once, with the engine's explicit flag. An output-directory lock can be bypassed by using another directory: it is an operational safeguard, not proof of untouched data. Exporting or viewing an existing report does not run that command. Do not retune after seeing holdout.

The original engine is experimental: its tests validate selected mechanics rather than establish a full independent audit. It models two-leg next-open returns, costs and supplied funding, with no intrabar liquidation, exact queueing, margin, partial-fill or live execution model. Deflated Sharpe is unavailable without complete trial genealogy. Paper/live readiness stays blocked until data, independent validation and the original runbook gates pass.

## Read-only input readiness audit

Run `python research/statarb/audit_inputs.py /path/to/historical_export` before research. This standard-library-only tool reports structural/provenance problems together, emits bounded JSON and includes content hashes for manifest/data. It does not run strategy selection, backtest or holdout. Exit 2 is blocked; exit 0 is only structural checks, not independent source verification. Details, limits and fee-evidence fields are in the research README. No actual market files or account-tier evidence have been supplied for this audit yet.
