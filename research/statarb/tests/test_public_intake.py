"""Offline source-integrity tests; never fetch market data or evaluate a strategy."""
from datetime import datetime, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import urllib.error
import zipfile

import pytest

spec = importlib.util.spec_from_file_location('public_intake', Path(__file__).parents[1] / 'collect_public.py')
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)


def fixture_zip(name='BTCUSDT-4h-2024-10.csv', text='open_time,open\n1,100\n'):
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w') as archive:
        archive.writestr(name, text)
    raw = output.getvalue()
    checksum = (hashlib.sha256(raw).hexdigest() + '  BTCUSDT-4h-2024-10.zip\n').encode()
    return raw, checksum


def test_checks_published_digest_name_and_zip_member_before_reading_rows():
    raw, checksum = fixture_zip()
    assert intake.verify_zip(raw, checksum, 'BTCUSDT-4h-2024-10.zip') == [{'open_time': '1', 'open': '100'}]
    with pytest.raises(ValueError, match='checksum/name'):
        intake.verify_zip(raw + b'changed', checksum, 'BTCUSDT-4h-2024-10.zip')
    with pytest.raises(ValueError, match='checksum/name'):
        intake.verify_zip(raw, checksum, 'ETHUSDT-4h-2024-10.zip')
    raw, checksum = fixture_zip('../escape.csv')
    with pytest.raises(ValueError, match='archive member'):
        intake.verify_zip(raw, checksum, 'BTCUSDT-4h-2024-10.zip')


def test_inventory_requires_explicit_pagination_and_preserves_non_ascii_prefixes():
    prefix = 'data/futures/um/monthly/klines/'
    xml = f'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Prefix>{prefix}</Prefix><IsTruncated>true</IsTruncated><NextMarker>next</NextMarker><CommonPrefixes><Prefix>{prefix}币安人生USDT/</Prefix></CommonPrefixes></ListBucketResult>'.encode()
    assert intake.parse_index(xml, prefix) == (['币安人生USDT'], 'next')
    with pytest.raises(ValueError, match='continuation'):
        intake.parse_index(xml.replace(b'<NextMarker>next</NextMarker>', b''), prefix)
    with pytest.raises(ValueError, match='prefix mismatch'):
        intake.parse_index(xml, 'wrong')


def test_does_not_replace_old_archive_pages_with_todays_universe():
    class Capture:
        def get(self, url):
            from urllib.parse import parse_qs, urlsplit
            query = parse_qs(urlsplit(url).query)
            prefix = query['prefix'][0]
            next_page = 'marker' in query
            symbol = 'DELISTEDUSDT' if next_page else 'BTCUSDT'
            tail = '<IsTruncated>false</IsTruncated>' if next_page else '<IsTruncated>true</IsTruncated><NextMarker>second</NextMarker>'
            return f'<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Prefix>{prefix}</Prefix>{tail}<CommonPrefixes><Prefix>{prefix}{symbol}/</Prefix></CommonPrefixes></ListBucketResult>'.encode(), {'status': 200}
    rows = intake.archive_inventory(Capture())
    assert [x['symbol'] for x in rows] == ['BTCUSDT', 'DELISTEDUSDT']
    assert all(not x['historical_contract_identity_verified'] for x in rows)
    assert rows[1]['archive_categories'] == ['fundingRate', 'klines', 'metrics']


def test_retains_restricted_access_as_a_gap_without_retry_or_zero_events(tmp_path, monkeypatch):
    calls = []
    def blocked(request, **kwargs):
        calls.append(request.full_url)
        raise urllib.error.HTTPError(request.full_url, 451, 'Unavailable', {}, None)
    monkeypatch.setattr(intake.urllib.request, 'urlopen', blocked)
    capture = intake.Capture(tmp_path)
    url = intake.ARCHIVE + 'data/test.zip'
    body, receipt = capture.get(url)
    assert body == b'' and receipt['status'] == 451
    assert capture.get(url)[1] == receipt
    assert len(calls) == 1
    with pytest.raises(ValueError, match='Only public archive'):
        capture.get('https://example.com/test.zip')


def test_cached_capture_rejects_tampered_original(tmp_path):
    url = intake.ARCHIVE + 'test.zip'
    key = hashlib.sha256(url.encode()).hexdigest()
    capture = intake.Capture(tmp_path)
    (capture.raw / (key + '.body')).write_bytes(b'tampered')
    (capture.raw / (key + '.json')).write_text(json.dumps({'url': url, 'status': 200, 'sha256': hashlib.sha256(b'original').hexdigest()}))
    with pytest.raises(ValueError, match='Cached source checksum'):
        capture.get(url)


def test_normalization_preserves_units_and_classifies_archive_rates_as_observations():
    t = 1727740800000
    row = {'open_time': str(t), 'close_time': str(t + 14399999), 'open': '100', 'high': '105', 'low': '95', 'close': '102', 'volume': '3', 'quote_volume': '306'}
    result = intake.normalize_bars([row], t, t + 14400000)
    assert result[0]['timestamp'] == '2024-10-01T00:00:00Z'
    assert result[0]['volume'] == '3' and result[0]['quote_volume'] == '306'
    assert intake.normalize_bars([row], t + 14400000, t + 28800000) == []
    with pytest.raises(ValueError, match='timestamp/close'):
        intake.normalize_bars([{**row, 'open_time': str(t * 1000)}], t, t + 14400000)
    rates = intake.normalize_rates([{'calc_time': str(t), 'last_funding_rate': '-0.0001', 'funding_interval_hours': '4'}], t, t + 14400000)
    assert rates[0]['rate'] == '-0.0001'
    assert 'not_independently_verified_settlement' in rates[0]['semantics']
    assert 'fundingTime' not in rates[0]
    with pytest.raises(ValueError):
        intake.normalize_rates([{'calc_time': str(t), 'last_funding_rate': 'NaN', 'funding_interval_hours': '4'}], t, t + 14400000)


def test_window_is_explicit_and_bounded():
    assert len(intake.months(intake.month_start('2024-09-01'), intake.month_start('2026-10-01'))) == 25
    with pytest.raises(ValueError):
        intake.month_start('2024-09-02')
    with pytest.raises(ValueError):
        intake.months(datetime(2020, 1, 1, tzinfo=timezone.utc), datetime(2026, 1, 1, tzinfo=timezone.utc))


def test_even_a_received_pilot_cannot_create_engine_ready_funding_or_membership(tmp_path):
    class Capture:
        root = tmp_path
        def csv_archive(self, key):
            if '/klines/' in key:
                rows = [{'open_time': '1727740800000', 'close_time': '1727755199999', 'open': '100', 'high': '105', 'low': '95', 'close': '102', 'volume': '3', 'quote_volume': '306'}]
            elif '/fundingRate/' in key:
                rows = [{'calc_time': '1727740800000', 'last_funding_rate': '0.0001', 'funding_interval_hours': '8'}]
            else:
                symbol = key.split('/')[-2]
                rows = [{'create_time': '2024-10-01 00:00:00', 'symbol': symbol, 'sum_open_interest_value': '1000000'}]
            return rows, {'key': key, 'status': 'checksum_verified'}
    report = intake.collect(Capture(), ['BTCUSDT', 'ETHUSDT'], intake.month_start('2024-10-01'), intake.month_start('2024-11-01'), 1)
    assert report['status'] == 'blocked'
    assert not report['gates']['funding_complete'] and not report['gates']['universe_point_in_time']
    assert report['verified_archives'] == 6
    assert not (tmp_path / 'funding').exists() and not (tmp_path / 'membership.csv').exists()
    assert not report['research_run'] and not report['holdout_evaluated']
