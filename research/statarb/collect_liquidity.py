"""Bounded weekly liquidity observations, never certified PIT membership or research.

Uses pinned pilot candles plus public checksum-verified daily metrics. Records an
explicit assumed publication lag; archive timestamps do not prove availability.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timedelta, timezone
from decimal import localcontext
import hashlib
import io
import json
from pathlib import Path
import re
import sys
import zipfile

from collect_public import Capture, csv_write, normalize_bars, numeric, write_json

sys.path.insert(0, str(Path(__file__).parent / 'src'))
from statarb.universe import universe_scope

STEP = timedelta(hours=4)
PUBLICATION_LAG = timedelta(minutes=5)
OBSERVATION_INTERVAL = timedelta(minutes=5)
MAX_OI_AGE = timedelta(minutes=15)
FIELDS = ['timestamp', 'symbol', 'open_interest_usd', 'volume_24h_usd',
          'oi_observed_at_utc', 'oi_assumed_available_at_utc', 'volume_window_start_utc',
          'volume_window_end_utc', 'volume_assumed_available_at_utc',
          'publication_lag_seconds_assumed', 'observation_interval_seconds_assumed',
          'metrics_nonmonotonic_transitions', 'metrics_rows', 'metrics_first_label_in_file',
          'metrics_last_label_in_file', 'metrics_min_label', 'metrics_max_label', 'observation_status']


def utc(value):
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None or stamp.utcoffset().total_seconds() != 0:
        raise ValueError('Explicit UTC required')
    return stamp


def date(value):
    return datetime.strptime(value, '%Y-%m-%d').replace(tzinfo=timezone.utc)


def calendar(start, end):
    if (not 0 < (end-start).total_seconds() <= 5*366*86400
            or any(t.hour or t.minute or t.second or t.microsecond or t.day != 1 for t in (start,end))):
        raise ValueError('Require first-of-month UTC boundaries and at most five years')
    if start.utcoffset() != timedelta(0) or end.utcoffset() != timedelta(0):
        raise ValueError('Calendar requires UTC')
    return [start+timedelta(days=i) for i in range(0, (end-start).days+1, 7) if start+timedelta(days=i) < end]


def pinned_rows(root, relative, hashes):
    path = root/relative
    if root.is_symlink() or any(p.is_symlink() for p in [path, path.parent, path.parent.parent]):
        raise ValueError('Symlink input refused')
    if path.stat().st_size > 32*1024*1024:
        raise ValueError('Pinned input too large')
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != hashes.get(relative):
        raise ValueError('Pinned input checksum mismatch: '+relative)
    return list(csv.DictReader(io.StringIO(raw.decode('utf-8-sig'))))


def bar_map(rows):
    result = {}
    for row in rows:
        t = utc(row['timestamp'])
        if t in result or t.timestamp() % 14400:
            raise ValueError('Duplicate/misaligned bar')
        o,h,l,c = [numeric(row[k], True) for k in ('open','high','low','close')]
        if h < max(o,l,c) or l > min(o,h,c) or numeric(row['volume'], True) <= 0 or numeric(row['quote_volume']) < 0:
            raise ValueError('Invalid bar or quote-volume observation')
        result[t] = row
    return result


def snapshot(symbol, decision, metrics, bars):
    previous, selected = None, None
    seen, labels, disorder = set(), [], 0
    source_day = (decision-timedelta(days=1)).date()
    for row in metrics:
        t = datetime.strptime(row['create_time'], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
        if row['symbol'] != symbol or not source_day <= t.date() <= decision.date() or t > decision or t in seen:
            raise ValueError('Metrics identity/day/duplicate mismatch')
        seen.add(t); labels.append(t)
        disorder += int(previous is not None and t < previous)
        numeric(row['sum_open_interest_value'])
        if numeric(row['sum_open_interest_value']) < 0:
            raise ValueError('Negative open interest')
        previous = t
        # Five minutes for uncertain start/end labeling, plus five for assumed
        # publication. Neither is a verified historical latency guarantee.
        if t+OBSERVATION_INTERVAL+PUBLICATION_LAG <= decision and (selected is None or t > selected[0]):
            selected = (t, row)
    if selected is None or decision-selected[0] > MAX_OI_AGE:
        raise ValueError('Missing/stale pre-decision open interest')
    # Use six completed 4h candles, with the volume window ending FOUR HOURS
    # before the snapshot. Do not use a candle that closes at/after decision.
    end = decision-STEP
    start = end-timedelta(days=1)
    times = [start+STEP*i for i in range(6)]
    if any(t not in bars for t in times):
        raise ValueError('Incomplete 24h quote-volume window; no fills')
    with localcontext() as context:
        context.prec = 50
        volume = sum(numeric(bars[t]['quote_volume']) for t in times)
    return {'timestamp': decision.isoformat(), 'symbol': symbol,
            'open_interest_usd': selected[1]['sum_open_interest_value'],
            'volume_24h_usd': str(volume), 'oi_observed_at_utc': selected[0].isoformat(),
            'oi_assumed_available_at_utc': (selected[0]+OBSERVATION_INTERVAL+PUBLICATION_LAG).isoformat(),
            'volume_window_start_utc': start.isoformat(), 'volume_window_end_utc': end.isoformat(),
            'volume_assumed_available_at_utc': (end+PUBLICATION_LAG).isoformat(),
            'publication_lag_seconds_assumed': 300,
            'observation_interval_seconds_assumed': 300,
            'metrics_nonmonotonic_transitions':disorder,'metrics_rows':len(metrics),
            'metrics_first_label_in_file':labels[0].isoformat(),'metrics_last_label_in_file':labels[-1].isoformat(),
            'metrics_min_label':min(labels).isoformat(),'metrics_max_label':max(labels).isoformat(),
            'observation_status': 'source_observation_not_certified_membership'}


def funding_grid_diagnostic(rows, start, end):
    """Compare observations to a NOMINAL 8h grid, not an external payment calendar.

    Preserve original timestamps/rates. Millisecond offsets are diagnostic only;
    no canonical event timestamp or inferred zero payment is produced.
    """
    width = 8*3600*1000
    lo,hi = int(start.timestamp()*1000),int(end.timestamp()*1000)
    if lo % width or hi % width:
        raise ValueError('Funding diagnostic requires 8h-aligned bounds')
    slots, previous, maximum_offset, reported_intervals = {}, None, 0, set()
    for row in rows:
        t = utc(row['timestamp']); ms = int(t.timestamp()*1000)
        if not lo <= ms < hi or (previous is not None and t <= previous):
            raise ValueError('Funding observation order/window mismatch')
        previous = t
        if abs(numeric(row['rate'])) > 1:
            raise ValueError('Invalid funding rate')
        interval = numeric(row['interval_hours'], True)
        if interval > 24:
            raise ValueError('Invalid funding interval')
        reported_intervals.add(str(interval))
        slot,offset = divmod(ms-lo, width)
        slots[slot] = slots.get(slot,0)+1
        maximum_offset = max(maximum_offset,offset)
    expected = (hi-lo)//width
    return {'observed_rows': len(rows), 'nominal_8h_slots': expected,
            'nominal_unoccupied_slots': expected-len(slots),
            'nominal_slots_with_multiple_observations': sum(n>1 for n in slots.values()),
            'maximum_offset_after_nominal_slot_ms': maximum_offset,
            'reported_interval_hours': sorted(reported_intervals),
            'independent_historical_schedule_verified': False,
            'actual_payable_population_verified': False,
            'semantics': 'nominal_grid_diagnostic_only_not_a_payment_completeness_certificate'}


def collect(capture, source, symbols, start, end, scope, workers=4):
    dates = calendar(start,end)
    if not 2 <= len(symbols) <= 20 or len(set(symbols)) != len(symbols) or not all(re.fullmatch(r'[A-Z0-9]+USDT', s) for s in symbols):
        raise ValueError('Supply 2–20 unique ASCII USDT pilot symbols')
    effective = universe_scope({'universe_scope': scope})
    if set(symbols) & {r['symbol'] for r in effective['exclusions']}:
        raise ValueError('Requested symbol is excluded by frozen scope')
    if workers not in range(1,5) or len(dates)*len(symbols) > 2500:
        raise ValueError('Collection bound exceeded')
    source = Path(source)
    crosscheck_raw = (source/'integrity-crosscheck.json').read_bytes()
    hashes = json.loads(crosscheck_raw)['files_sha256']
    panels, funding_diagnostics, input_hashes, receipts = {}, {}, {}, []
    failures, observations = [], []
    for symbol in symbols:
        relative = f'observations/bars/{symbol}.csv'
        bars = pinned_rows(source,relative,hashes); input_hashes[relative] = hashes[relative]
        frelative = f'observations/funding_rates/{symbol}.csv'
        rates = pinned_rows(source,frelative,hashes); input_hashes[frelative] = hashes[frelative]
        funding_diagnostics[symbol] = funding_grid_diagnostic(rates,start,end)
        # Monthly candle source for the 28h warm-up preceding the first snapshot.
        month = (start-timedelta(days=1)).strftime('%Y-%m')
        key = f'data/futures/um/monthly/klines/{symbol}/4h/{symbol}-4h-{month}.zip'
        try:
            raw_rows,receipt = capture.csv_archive(key)
        except (ValueError,KeyError,TypeError,zipfile.BadZipFile,UnicodeError) as exc:
            raw_rows,receipt = None,{'key':key,'status':'invalid_source','error':str(exc)}
        receipts.append(receipt)
        if raw_rows is not None:
            warm = normalize_bars(raw_rows,int((start-timedelta(hours=28)).timestamp()*1000),int(start.timestamp()*1000))
            bars = warm+bars
        else:
            failures.append({'symbol': symbol,'kind':'warmup_unavailable','key':key})
        panels[symbol] = bar_map(bars)
    jobs = [(symbol,t) for symbol in symbols for t in dates]
    def run(job):
        symbol,t = job
        day = (t-timedelta(days=1)).strftime('%Y-%m-%d')
        key = f'data/futures/um/daily/metrics/{symbol}/{symbol}-metrics-{day}.zip'
        try:
            rows,receipt = capture.csv_archive(key)
            if rows is None:
                return None,receipt,{'symbol':symbol,'timestamp':t.isoformat(),'kind':'metrics_unavailable','key':key}
            return snapshot(symbol,t,rows,panels[symbol]),receipt,None
        except (ValueError,KeyError,TypeError,csv.Error,zipfile.BadZipFile,UnicodeError) as exc:
            return None,{'key':key,'status':'invalid_source'}, {'symbol':symbol,'timestamp':t.isoformat(),'kind':'invalid_snapshot_source','error':str(exc)}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for n,(row,receipt,error) in enumerate(pool.map(run,jobs),1):
            receipts.append(receipt)
            if row is not None:
                observations.append(row)
            if error is not None:
                failures.append(error)
            if n % 25 == 0:
                print(json.dumps({'completed':n,'planned':len(jobs)}),flush=True)
    csv_write(capture.root/'observations/liquidity.csv',observations,FIELDS)
    report = {'schema_version':1,'purpose':'weekly_source_liquidity_pilot_not_certified_pit',
              'status':'blocked','start_inclusive':start.isoformat(),'end_exclusive':end.isoformat(),
              'symbols':symbols,'planned_snapshot_dates':len(dates),'planned_observations':len(jobs),
              'received_observations':len(observations),'observation_grid_complete':len(observations)==len(jobs) and not failures,
              'metrics_files_with_nonmonotonic_labels':sum(r['metrics_nonmonotonic_transitions']>0 for r in observations),
              'first_snapshot':dates[0].isoformat(),'last_snapshot':dates[-1].isoformat(),
              'source_objects':receipts,'verified_archives':sum(r['status']=='checksum_verified' for r in receipts),
              'failures':failures,'input_files_sha256':input_hashes,
              'source_integrity_receipt_sha256':hashlib.sha256(crosscheck_raw).hexdigest(),
              'universe_scope':effective,'funding_grid_diagnostics':funding_diagnostics,
              'timing_policy':{'assumed_publication_lag_seconds':300,'assumed_observation_interval_seconds':300,'max_oi_age_seconds':900,
                               'volume_window_end_lag_hours':4,'metrics_timezone_assumed':'UTC',
                               'historical_publication_latency_verified':False,'metrics_label_convention_verified':False,
                               'unordered_unique_rows':'select maximum eligible source label without rewriting or sorting originals; report disorder'},
              'gates':{'funding_complete':False,'universe_point_in_time':False,
                       'contract_identity_lifecycle_verified':False,'historical_availability_verified':False},
              'research_run':False,'holdout_evaluated':False,'trading_authorized':False}
    write_json(capture.root/'liquidity-audit.json',report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,required=True,help='Pinned original pilot intake folder')
    parser.add_argument('--scope',type=Path,required=True,help='Frozen universe_scope object')
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--symbols',default='BTCUSDT,ETHUSDT')
    parser.add_argument('--start',default='2024-09-01')
    parser.add_argument('--end',default='2026-10-01')
    parser.add_argument('--workers',type=int,choices=range(1,5),default=4)
    args = parser.parse_args(argv)
    if args.out.resolve() == args.source.resolve() or args.source.resolve() in args.out.resolve().parents:
        parser.error('Use a separate capture directory; never mutate the original intake')
    report = collect(Capture(args.out),args.source,args.symbols.split(','),date(args.start),date(args.end),json.loads(args.scope.read_text()),args.workers)
    print(json.dumps({k:report[k] for k in ('status','planned_observations','received_observations','observation_grid_complete','verified_archives','failures','funding_grid_diagnostics')},indent=2))
    return 2 if report['failures'] else 0  # Zero means collection completed, never certification.


if __name__ == '__main__':
    raise SystemExit(main())
