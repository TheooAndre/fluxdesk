"""Read-only structural preflight. No strategy imports, simulation or holdout access."""
from __future__ import annotations
import argparse
import csv
from datetime import datetime, timezone
import hashlib
import io
import json
import math
from pathlib import Path
import sys

# Keep this standalone preflight standard-library only.
sys.path.insert(0, str(Path(__file__).parent / 'src'))
from statarb.universe import universe_scope

MAX_FILE = 50 * 1024 * 1024
MAX_TOTAL = 512 * 1024 * 1024
MAX_SYMBOLS = 200


def utc(value):
    time = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
    if time.tzinfo is None or time.utcoffset().total_seconds() != 0:
        raise ValueError('Timestamp requires explicit UTC')
    return time.astimezone(timezone.utc)


def audit_folder(folder):
    root = Path(folder)
    issues, counts, hashes = [], {}, {}
    total = 0
    error_count = 0
    def issue(code, file, severity='error'):
        nonlocal error_count
        if severity == 'error':
            error_count += 1
        counts[code] = counts.get(code, 0) + 1
        if len(issues) < 100:
            issues.append({'code': code, 'file': file, 'severity': severity})
    def read(relative):
        nonlocal total
        path = root / relative
        if root.is_symlink() or any(part.is_symlink() for part in [path, *list(path.parents)[:len(Path(relative).parts)-1]]):
            raise ValueError('Symlinks are not accepted')
        size = path.stat().st_size
        if not path.is_file() or size > MAX_FILE or total + size > MAX_TOTAL:
            raise ValueError('Input size limit exceeded')
        raw = path.read_bytes()
        total += len(raw)
        if len(raw) > MAX_FILE or total > MAX_TOTAL:
            raise ValueError('Input size limit exceeded')
        hashes[relative] = hashlib.sha256(raw).hexdigest()
        return raw.decode('utf-8-sig')
    def rows(relative, columns):
        reader = csv.DictReader(io.StringIO(read(relative)))
        if not set(columns).issubset(reader.fieldnames or []):
            raise ValueError('Required columns missing')
        return reader
    def number(value, positive=False):
        n = float(value)
        if not math.isfinite(n) or (positive and n <= 0):
            raise ValueError('Invalid number')
        return n
    manifest = {}
    try:
        manifest = json.loads(read('manifest.json'))
        if not isinstance(manifest, dict):
            raise ValueError('Manifest must be an object')
    except (OSError, ValueError, UnicodeError):
        issue('invalid_manifest', 'manifest.json')
        manifest = {}
    try:
        scope = universe_scope(manifest)
    except (ValueError, TypeError):
        issue('invalid_universe_scope', 'manifest.json')
        scope = universe_scope({})
    excluded = {row['symbol'] for row in scope['exclusions']}
    if excluded:
        issue('data_quality_subset_bias', 'manifest.json', 'warning')
    for key in ['funding_complete', 'universe_point_in_time']:
        if manifest.get(key) is not True:
            issue('unverified_' + key, 'manifest.json')
    if manifest.get('contract_type') != 'linear_perpetual' or manifest.get('quote_currency') not in ['USD', 'USDT', 'USDC'] or not isinstance(manifest.get('venue'), str) or not manifest.get('venue'):
        issue('invalid_contract_identity', 'manifest.json')
    if not manifest.get('data_vendor'):
        issue('missing_vendor_provenance', 'manifest.json')
    try:
        captured = utc(manifest['extracted_at_utc'])
    except (KeyError, ValueError, TypeError):
        captured = None
        issue('invalid_extraction_time', 'manifest.json')
    evidence = manifest.get('fee_evidence', {})
    try:
        if not isinstance(evidence, dict) or not all(isinstance(evidence.get(k), str) and evidence[k].strip() for k in ['source', 'account_tier']):
            raise ValueError('Missing fee evidence')
        utc(evidence['observed_at_utc'])
        for key in ['maker_bps', 'taker_bps']:
            if isinstance(evidence[key], bool) or not isinstance(evidence[key], (int, float)) or not 0 <= number(evidence[key]) <= 100:
                raise ValueError('Invalid fee rate')
    except (KeyError, ValueError, TypeError):
        issue('missing_or_invalid_fee_evidence', 'manifest.json')
    summaries = []
    for directory in ['bars', 'funding']:
        if (root / directory).is_symlink():
            issue('symlink_directory', directory)
    paths = sorted((root / 'bars').glob('*.csv')) if not (root / 'bars').is_symlink() else []
    excluded_histories = [p.stem for p in paths if p.stem in excluded]
    paths = [p for p in paths if p.stem not in excluded]
    if not 2 <= len(paths) <= MAX_SYMBOLS:
        issue('requires_2_to_200_histories', 'bars')
    first_global, last_global = None, None
    for path in paths[:MAX_SYMBOLS]:
        symbol = path.stem
        relative = 'bars/' + path.name
        first, previous, count = None, None, 0
        try:
            for row in rows(relative, ['timestamp', 'open', 'high', 'low', 'close', 'volume']):
                t = utc(row['timestamp'])
                o, h, l, c, v = [number(row[k], True) for k in ['open', 'high', 'low', 'close', 'volume']]
                if h < max(o, c, l) or l > min(o, c, h):
                    issue('invalid_ohlc', relative)
                if previous and (t - previous).total_seconds() != 4 * 3600:
                    issue('noncontiguous_4h_bars', relative)
                if captured and (captured-t).total_seconds() < 4 * 3600:
                    issue('unfinished_or_future_bar', relative)
                first = first or t
                previous = t
                count += 1
            if not count:
                issue('empty_bars', relative)
        except (OSError, ValueError, TypeError, UnicodeError, csv.Error):
            issue('invalid_bars', relative)
        if first and previous:
            first_global = min(first_global, first) if first_global else first
            last_global = max(last_global, previous) if last_global else previous
        funding_count, funding_first, funding_last, long_gaps = 0, None, None, 0
        frelative = 'funding/' + path.name
        try:
            for row in rows(frelative, ['timestamp', 'rate']):
                t, rate = utc(row['timestamp']), number(row['rate'])
                if abs(rate) > 1 or (funding_last and t <= funding_last):
                    issue('invalid_funding_order_or_rate', frelative)
                if captured and t > captured:
                    issue('future_funding', frelative)
                if funding_last and (t-funding_last).total_seconds() > 8 * 3600:
                    long_gaps += 1
                funding_first = funding_first or t
                funding_last = t
                funding_count += 1
            if not funding_count:
                issue('empty_funding', frelative)
            if long_gaps:
                issue('funding_spacing_requires_review', frelative, 'warning')
        except (OSError, ValueError, TypeError, UnicodeError, csv.Error):
            issue('missing_or_invalid_funding', frelative)
        summaries.append({'symbol': symbol, 'bars': count, 'first_bar': first.isoformat() if first else None, 'last_bar': previous.isoformat() if previous else None, 'funding_events': funding_count, 'first_funding': funding_first.isoformat() if funding_first else None, 'last_funding': funding_last.isoformat() if funding_last else None, 'observed_funding_gaps_over_8h': long_gaps})
    snapshots, active_symbols = {}, set()
    try:
        for row in rows('membership.csv', ['timestamp', 'symbol', 'active', 'linear', 'quote', 'open_interest_usd', 'volume_24h_usd']):
            symbol = row['symbol']
            if symbol in excluded:
                continue
            t = utc(row['timestamp'])
            group = snapshots.setdefault(t, set())
            if symbol in group:
                issue('duplicate_membership', 'membership.csv')
            group.add(symbol)
            if row['active'] not in ['True', 'False', 'true', 'false', '1', '0'] or row['linear'] not in ['True', 'False', 'true', 'false', '1', '0']:
                issue('invalid_membership_boolean', 'membership.csv')
            if row['active'] in ['True', 'true', '1']:
                active_symbols.add(symbol)
                if row['quote'] != manifest.get('quote_currency') or row['linear'] not in ['True', 'true', '1']:
                    issue('mixed_contract_membership', 'membership.csv')
            if number(row['open_interest_usd']) < 0 or number(row['volume_24h_usd']) < 0:
                issue('invalid_membership_financials', 'membership.csv')
        times = sorted(snapshots)
        if not times:
            issue('empty_membership', 'membership.csv')
        else:
            if first_global and times[0] > first_global:
                issue('membership_starts_after_bars', 'membership.csv')
            if any((b-a).total_seconds() > 7*86400 for a,b in zip(times,times[1:])) or (last_global and (last_global-times[-1]).total_seconds() > 7*86400):
                issue('stale_membership_snapshots', 'membership.csv')
            missing = active_symbols - {p.stem for p in paths}
            for symbol in sorted(missing):
                issue('active_market_missing_history', 'bars/' + symbol + '.csv')
    except (OSError, ValueError, TypeError, UnicodeError, csv.Error):
        issue('invalid_membership', 'membership.csv')
    span_days = (last_global-first_global).total_seconds()/86400 if first_global and last_global else 0
    if span_days < 730:
        issue('less_than_two_years_of_history', 'bars')
    intervals = [(utc(s['first_bar']), utc(s['last_bar'])) for s in summaries if s['first_bar'] and s['last_bar']]
    if not any((min(a[1],b[1])-max(a[0],b[0])).total_seconds() >= 180*86400 for i,a in enumerate(intervals) for b in intervals[i+1:]):
        issue('no_two_histories_overlap_180_days', 'bars')
    fingerprint = hashlib.sha256(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return {'schema_version': 1, 'status': 'blocked' if error_count else 'structural_checks_only', 'audit_input_sha256': fingerprint, 'files_sha256': hashes, 'issue_counts': counts, 'issues': issues, 'issues_truncated': sum(counts.values()) > len(issues), 'symbols': summaries, 'universe_scope': scope, 'excluded_bar_files_not_evaluated': excluded_histories, 'union_span_days': span_days, 'membership_snapshots': len(snapshots), 'independent_funding_and_pit_audit': False, 'holdout_opened': False, 'research_run': False, 'trading_authorized': False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('folder')
    args = parser.parse_args(argv)
    report = audit_folder(args.folder)
    print(json.dumps(report, indent=2, allow_nan=False))
    return 2 if report['status'] == 'blocked' else 0


if __name__ == '__main__':
    raise SystemExit(main())
