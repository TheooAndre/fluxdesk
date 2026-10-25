"""Public archive intake, never strategy selection or certification of historical completeness.

Standard library only. Collects immutable, checksum-verified originals and observations.
Does not create an engine-ready funding or PIT membership file. No authenticated APIs.
"""
from __future__ import annotations
import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import hashlib
import io
import json
from pathlib import Path
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

ARCHIVE = 'https://data.binance.vision/'
INDEX = 'https://s3-ap-northeast-1.amazonaws.com/data.binance.vision'
MAX_BODY = 32 * 1024 * 1024
MAX_DOWNLOAD = 256 * 1024 * 1024
NS = {'s': 'http://s3.amazonaws.com/doc/2006-03-01/'}
KINDS = ('klines', 'fundingRate', 'metrics')


def iso(ms):
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat().replace('+00:00', 'Z')


def month_start(value):
    t = datetime.strptime(value, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    if t.day != 1:
        raise ValueError('Use first-of-month UTC boundaries')
    return t


def months(start, end):
    if not start < end or (end.year - start.year) * 12 + end.month - start.month > 60:
        raise ValueError('Require a positive window of at most 60 months')
    result = []
    while start < end:
        result.append(start.strftime('%Y-%m'))
        start = start.replace(year=start.year + (start.month == 12), month=start.month % 12 + 1)
    return result


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')
    temporary.replace(path)


class Capture:
    """Four workers maximum, globally paced; failed/restricted access is evidence, not a bypass target."""
    def __init__(self, root):
        self.root = Path(root)
        if self.root.is_symlink():
            raise ValueError('Output must not be a symlink')
        self.raw = self.root / 'raw'
        self.raw.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.next_request = 0.0
        self.total = 0

    def get(self, url):
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != 'https' or parsed.hostname not in ('data.binance.vision', 's3-ap-northeast-1.amazonaws.com'):
            raise ValueError('Only public archive/index origins are supported')
        key = hashlib.sha256(url.encode()).hexdigest()
        receipt_path, body_path = self.raw / (key + '.json'), self.raw / (key + '.body')
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_text())
            if receipt['url'] != url:
                raise ValueError('Cached URL mismatch')
            body = body_path.read_bytes() if receipt['status'] == 200 else b''
            if hashlib.sha256(body).hexdigest() != receipt['sha256']:
                raise ValueError('Cached source checksum mismatch')
            with self.lock:
                self.total += len(body)
                if self.total > MAX_DOWNLOAD:
                    raise ValueError('Capture download budget exceeded')
            return body, receipt
        with self.lock:
            delay = max(0, self.next_request - time.monotonic())
            self.next_request = max(time.monotonic(), self.next_request) + 0.25
        if delay:
            time.sleep(delay)
        fetched = datetime.now(timezone.utc).isoformat()
        status, headers, body, error = 0, {}, b'', None
        # No automatic retries for restrictions, missing files or other failures.
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'FluxDesk-research-intake/1.0 (personal non-production research)'})
            with urllib.request.urlopen(request, timeout=25) as response:
                # Reject cross-origin redirects even if a provider changes its routing.
                if urllib.parse.urlsplit(response.url).hostname != parsed.hostname:
                    raise ValueError('Unexpected archive redirect')
                status = response.status
                headers = {k: response.headers.get(k) for k in ('Content-Type', 'Content-Length', 'Last-Modified', 'ETag', 'Date')}
                body = response.read(MAX_BODY + 1)
                if len(body) > MAX_BODY:
                    raise ValueError('Source object too large')
        except urllib.error.HTTPError as exc:
            status, error = exc.code, 'HTTP ' + str(exc.code)
        except (OSError, ValueError) as exc:
            error = type(exc).__name__ + ': ' + str(exc)
            status, body = 0, b''
        with self.lock:
            self.total += len(body)
            if self.total > MAX_DOWNLOAD:
                raise ValueError('Capture download budget exceeded')
        receipt = {'url': url, 'fetched_at_utc': fetched, 'status': status, 'bytes': len(body),
                   'sha256': hashlib.sha256(body).hexdigest(), 'headers': headers, 'error': error}
        if status == 200:
            with body_path.open('xb') as output:
                output.write(body)
        write_json(receipt_path, receipt)
        return body, receipt

    def csv_archive(self, key):
        checksum, check_receipt = self.get(ARCHIVE + key + '.CHECKSUM')
        if check_receipt['status'] != 200:
            return None, {'key': key, 'status': 'checksum_unavailable', 'http_status': check_receipt['status']}
        raw, receipt = self.get(ARCHIVE + key)
        if receipt['status'] != 200:
            return None, {'key': key, 'status': 'archive_unavailable', 'http_status': receipt['status']}
        rows = verify_zip(raw, checksum, key.rsplit('/', 1)[-1])
        return rows, {'key': key, 'status': 'checksum_verified', 'bytes': len(raw), 'sha256': receipt['sha256'],
                      'checksum_receipt_sha256': check_receipt['sha256']}


def verify_zip(raw, checksum, filename):
    match = re.fullmatch(r'([a-fA-F0-9]{64})\s+\*?([^\r\n]+)\s*', checksum.decode().strip())
    if not match or match.group(2) != filename or hashlib.sha256(raw).hexdigest() != match.group(1).lower():
        raise ValueError('Published checksum/name mismatch')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        infos = archive.infolist()
        if len(infos) != 1 or infos[0].filename != filename.removesuffix('.zip') + '.csv' or infos[0].file_size > MAX_BODY:
            raise ValueError('Unexpected or oversized archive member')
        text = archive.read(infos[0]).decode('utf-8-sig')
    reader = csv.DictReader(io.StringIO(text))
    if not reader.fieldnames or len(set(reader.fieldnames)) != len(reader.fieldnames):
        raise ValueError('Missing/duplicate CSV headers')
    return list(reader)


def archive_inventory(capture):
    discovered = {}
    for kind in KINDS:
        cadence = 'daily' if kind == 'metrics' else 'monthly'
        prefix = f'data/futures/um/{cadence}/{kind}/'
        marker, seen = '', set()
        for _ in range(10):
            query = {'delimiter': '/', 'prefix': prefix, 'max-keys': '1000'}
            if marker:
                query['marker'] = marker
            raw, receipt = capture.get(INDEX + '?' + urllib.parse.urlencode(query))
            if receipt['status'] != 200:
                raise ValueError('Inventory request unavailable; no complete inventory claim')
            symbols, next_marker = parse_index(raw, prefix)
            for symbol in symbols:
                discovered.setdefault(symbol, set()).add(kind)
            if not next_marker:
                break
            if next_marker in seen:
                raise ValueError('Repeated inventory pagination marker')
            seen.add(next_marker)
            marker = next_marker
        else:
            raise ValueError('Inventory page bound exceeded')
    return [{'symbol': s, 'archive_categories': sorted(k), 'usdt_name_candidate': s.endswith('USDT'),
             'historical_contract_identity_verified': False} for s, k in sorted(discovered.items())]


def parse_index(raw, prefix):
    root = ET.fromstring(raw)
    if root.findtext('s:Prefix', namespaces=NS) != prefix:
        raise ValueError('Inventory prefix mismatch')
    symbols = []
    for element in root.findall('s:CommonPrefixes/s:Prefix', NS):
        value = element.text or ''
        if not value.startswith(prefix) or not value.endswith('/'):
            raise ValueError('Unexpected archive prefix')
        symbol = value[len(prefix):-1]
        if not 2 <= len(symbol) <= 100 or any(c in symbol for c in '/\\') or any(ord(c) < 32 for c in symbol):
            raise ValueError('Unexpected archive symbol')
        symbols.append(symbol)
    truncated = root.findtext('s:IsTruncated', namespaces=NS)
    if truncated not in ('true', 'false'):
        raise ValueError('Missing pagination state')
    marker = root.findtext('s:NextMarker', namespaces=NS) if truncated == 'true' else None
    if truncated == 'true' and not marker:
        raise ValueError('Truncated inventory without continuation')
    return symbols, marker


def numeric(value, positive=False):
    try:
        n = Decimal(value)
    except (InvalidOperation, TypeError):
        raise ValueError('Invalid numeric field') from None
    if not n.is_finite() or (positive and n <= 0):
        raise ValueError('Invalid numeric field')
    return n


def normalize_bars(rows, start_ms, end_ms):
    result = []
    for row in rows:
        t = int(row['open_time'])
        if t % 14_400_000 or int(row['close_time']) != t + 14_399_999:
            raise ValueError('Unsupported 4h candle timestamp/close convention')
        o, h, l, c = [numeric(row[k], True) for k in ('open', 'high', 'low', 'close')]
        if h < max(o, l, c) or l > min(o, h, c) or numeric(row['volume']) < 0 or numeric(row['quote_volume']) < 0:
            raise ValueError('Invalid OHLC/volume')
        if start_ms <= t < end_ms:
            result.append({'timestamp': iso(t), **{k: row[k] for k in ('open', 'high', 'low', 'close', 'volume', 'quote_volume')}})
    return result


def normalize_rates(rows, start_ms, end_ms):
    result = []
    for row in rows:
        t = int(row['calc_time'])
        rate = numeric(row['last_funding_rate'])
        interval = numeric(row['funding_interval_hours'], True)
        if abs(rate) > 1 or interval > 24:
            raise ValueError('Invalid observed funding rate/interval')
        if start_ms <= t < end_ms:
            result.append({'timestamp': iso(t), 'rate': row['last_funding_rate'], 'interval_hours': row['funding_interval_hours'],
                           'semantics': 'archive_calc_time_observation_not_independently_verified_settlement'})
    return result


def csv_write(path, rows, fields):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', newline='') as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def collect(capture, symbols, start, end, workers=4):
    window = months(start, end)
    lo, hi = int(start.timestamp() * 1000), int(end.timestamp() * 1000)
    jobs = [(symbol, kind, month) for symbol in symbols for kind in KINDS for month in window]
    def run(job):
        symbol, kind, month = job
        if kind == 'klines':
            key = f'data/futures/um/monthly/klines/{symbol}/4h/{symbol}-4h-{month}.zip'
        elif kind == 'fundingRate':
            key = f'data/futures/um/monthly/fundingRate/{symbol}/{symbol}-fundingRate-{month}.zip'
        else:
            key = f'data/futures/um/daily/metrics/{symbol}/{symbol}-metrics-{month}-01.zip'
        try:
            rows, receipt = capture.csv_archive(key)
            if rows is not None:
                rows = normalize_bars(rows, lo, hi) if kind == 'klines' else normalize_rates(rows, lo, hi) if kind == 'fundingRate' else rows
            return job, rows, receipt
        except (ValueError, KeyError, TypeError, zipfile.BadZipFile, UnicodeError) as exc:
            return job, None, {'key': key, 'status': 'invalid_source', 'error': str(exc)}
    grouped, receipts = {}, []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for n, (job, rows, receipt) in enumerate(pool.map(run, jobs), 1):
            symbol, kind, _ = job
            grouped.setdefault((symbol, kind), []).extend(rows or [])
            receipts.append(receipt)
            if n % 25 == 0:
                print(json.dumps({'completed': n, 'planned': len(jobs)}), flush=True)
    summaries = []
    for symbol in symbols:
        bars = grouped[(symbol, 'klines')]
        rates = grouped[(symbol, 'fundingRate')]
        metrics = grouped[(symbol, 'metrics')]
        bar_times = [r['timestamp'] for r in bars]
        rate_times = [r['timestamp'] for r in rates]
        gaps = sum((datetime.fromisoformat(b.replace('Z', '+00:00')) - datetime.fromisoformat(a.replace('Z', '+00:00'))).total_seconds() != 14400 for a, b in zip(bar_times, bar_times[1:]))
        duplicate_bars = len(bar_times) - len(set(bar_times))
        duplicate_rates = len(rate_times) - len(set(rate_times))
        bad_metrics = 0
        for row in metrics:
            try:
                if row['symbol'] != symbol or numeric(row['sum_open_interest_value']) < 0:
                    raise ValueError('Metrics identity/value mismatch')
                t = datetime.strptime(row['create_time'], '%Y-%m-%d %H:%M:%S').replace(tzinfo=timezone.utc)
                if not start <= t < end:
                    raise ValueError('Metrics outside intake window')
            except (ValueError, KeyError, TypeError):
                bad_metrics += 1
        # Do not sort/deduplicate to conceal ordering or source conflicts.
        if duplicate_bars or gaps:
            bar_status = 'internal_gaps_or_duplicates_require_review'
        else:
            bar_status = 'observed_span_contiguous' if bars else 'unavailable'
        csv_write(capture.root / 'observations/bars' / (symbol + '.csv'), bars,
                  ['timestamp', 'open', 'high', 'low', 'close', 'volume', 'quote_volume'])
        csv_write(capture.root / 'observations/funding_rates' / (symbol + '.csv'), rates,
                  ['timestamp', 'rate', 'interval_hours', 'semantics'])
        csv_write(capture.root / 'observations/metrics_month_start_days' / (symbol + '.csv'), metrics,
                  sorted({k for r in metrics for k in r}) if metrics else ['create_time', 'symbol', 'sum_open_interest', 'sum_open_interest_value'])
        summaries.append({'symbol': symbol, 'bars': len(bars), 'first_bar': bar_times[0] if bars else None,
                          'last_bar': bar_times[-1] if bars else None, 'internal_bar_gaps': gaps, 'duplicate_bars': duplicate_bars,
                          'zero_volume_bars': sum(numeric(r['volume']) == 0 for r in bars), 'bar_status': bar_status,
                          'observed_funding_rates': len(rates), 'duplicate_funding_timestamps': duplicate_rates,
                          'metrics_observations': len(metrics), 'invalid_metrics_observations': bad_metrics,
                          'lifecycle_verified': False, 'funding_population_verified': False})
    report = {'schema_version': 1, 'purpose': 'source_qualification_pilot_not_a_research_universe', 'status': 'blocked',
              'start_inclusive': start.isoformat(), 'end_exclusive': end.isoformat(), 'symbols': summaries,
              'source_objects': receipts, 'verified_archives': sum(r['status'] == 'checksum_verified' for r in receipts),
              'unavailable_or_invalid_objects': sum(r['status'] != 'checksum_verified' for r in receipts),
              'gates': {'checksum_integrity_for_received_archives': any(r['status'] == 'checksum_verified' for r in receipts) and all(r['status'] != 'invalid_source' for r in receipts),
                        'funding_complete': False, 'universe_point_in_time': False, 'historical_lifecycle_verified': False,
                        'complete_historical_oi_and_volume_snapshots': False, 'owner_account_fee_evidence': False},
              'research_run': False, 'holdout_evaluated': False, 'trading_authorized': False}
    write_json(capture.root / 'source-audit.json', report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['inventory', 'collect'])
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--symbols', default='BTCUSDT,ETHUSDT,FTMUSDT,LINAUSDT,LUNAUSDT')
    parser.add_argument('--start', default='2024-09-01')
    parser.add_argument('--end', default='2026-10-01')
    parser.add_argument('--workers', type=int, choices=range(1, 5), default=4)
    args = parser.parse_args(argv)
    capture = Capture(args.out)
    if args.mode == 'inventory':
        inventory = archive_inventory(capture)
        write_json(args.out / 'archive-inventory.json', {'symbols': inventory, 'point_in_time_universe_verified': False,
                   'meaning': 'Archive prefix availability only; not immutable identity or listing/delisting history'})
        print(json.dumps({'archive_prefixes': len(inventory), 'usdt_name_candidates': sum(x['usdt_name_candidate'] for x in inventory)}))
    else:
        symbols = args.symbols.split(',')
        if not 2 <= len(symbols) <= 20 or len(set(symbols)) != len(symbols) or not all(re.fullmatch(r'[A-Z0-9]+USDT', s) for s in symbols):
            parser.error('Supply 2–20 unique USDT symbols; this command is a bounded qualification pilot')
        report = collect(capture, symbols, month_start(args.start), month_start(args.end), args.workers)
        print(json.dumps({k: report[k] for k in ('status', 'verified_archives', 'unavailable_or_invalid_objects', 'symbols')}, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
