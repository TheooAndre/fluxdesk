"""Causal source observations only; no network, empirical strategy or holdout."""
import csv
from datetime import timedelta
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import pytest

sys.path.insert(0,str(Path(__file__).parents[1]))
spec = importlib.util.spec_from_file_location('liquidity_intake',Path(__file__).parents[1]/'collect_liquidity.py')
liquidity = importlib.util.module_from_spec(spec); spec.loader.exec_module(liquidity)

START,END = liquidity.date('2024-09-01'),liquidity.date('2024-10-01')


def bar(t, quote='10.000000000000000001'):
    return {'timestamp':t.isoformat(),'open':'100','high':'101','low':'99','close':'100','volume':'1','quote_volume':quote}


def metrics(t, symbol='BTCUSDT'):
    return [{'create_time':(t-timedelta(minutes=10)).strftime('%Y-%m-%d %H:%M:%S'),'symbol':symbol,'sum_open_interest_value':'123.45'}]


def bars(t):
    return liquidity.bar_map([bar(t-timedelta(hours=28)+timedelta(hours=4*i)) for i in range(8)])


def test_snapshot_uses_only_completed_lagged_bars_and_metric_availability_assumption():
    panel=bars(START)
    panel[START-timedelta(hours=4)] = bar(START-timedelta(hours=4),'99999999999')
    panel[START] = bar(START,'99999999999')
    row=liquidity.snapshot('BTCUSDT',START,metrics(START),panel)
    assert row['volume_24h_usd']=='60.000000000000000006'
    assert row['oi_observed_at_utc']==(START-timedelta(minutes=10)).isoformat()
    assert row['oi_assumed_available_at_utc']==START.isoformat()
    assert liquidity.utc(row['volume_window_end_utc'])==START-timedelta(hours=4)
    assert liquidity.utc(row['volume_assumed_available_at_utc']) < START
    assert row['observation_status']=='source_observation_not_certified_membership'


@pytest.mark.parametrize('change', ['wrong_symbol','wrong_day','duplicate','stale','negative','nan'])
def test_invalid_metrics_fail_instead_of_becoming_membership(change):
    rows=metrics(START)
    if change=='wrong_symbol': rows[0]['symbol']='ETHUSDT'
    if change=='wrong_day': rows[0]['create_time']='2024-09-01 00:05:00'
    if change=='duplicate': rows=rows*2
    if change=='stale': rows[0]['create_time']='2024-08-31 23:40:00'
    if change=='negative': rows[0]['sum_open_interest_value']='-1'
    if change=='nan': rows[0]['sum_open_interest_value']='NaN'
    with pytest.raises(ValueError): liquidity.snapshot('BTCUSDT',START,rows,bars(START))


def test_unordered_unique_source_labels_are_preserved_and_flagged_not_silently_repaired():
    rows=metrics(START)+metrics(START-timedelta(minutes=5))
    original=json.dumps(rows)
    result=liquidity.snapshot('BTCUSDT',START,rows,bars(START))
    assert result['metrics_nonmonotonic_transitions']==1
    assert result['oi_observed_at_utc']==(START-timedelta(minutes=10)).isoformat()
    assert result['metrics_first_label_in_file'] > result['metrics_last_label_in_file']
    assert json.dumps(rows)==original


def test_ambiguous_midnight_row_is_retained_in_diagnostics_but_not_used_early():
    rows=metrics(START)+[{'create_time':'2024-09-01 00:00:00','symbol':'BTCUSDT','sum_open_interest_value':'99999'}]
    row=liquidity.snapshot('BTCUSDT',START,rows,bars(START))
    assert row['open_interest_usd']=='123.45'
    assert row['metrics_max_label']==START.isoformat()


def test_missing_bar_never_filled_and_duplicate_bar_never_deduplicated():
    panel=bars(START); del panel[START-timedelta(hours=12)]
    with pytest.raises(ValueError,match='Incomplete'):liquidity.snapshot('BTCUSDT',START,metrics(START),panel)
    with pytest.raises(ValueError,match='Duplicate'):liquidity.bar_map([bar(START),bar(START)])
    with pytest.raises(ValueError):liquidity.bar_map([bar(START,'NaN')])


def test_calendar_full_window_and_funding_diagnostic_do_not_certify_payments():
    assert len(liquidity.calendar(START,liquidity.date('2026-10-01')))==109
    rows=[{'timestamp':START.isoformat(),'rate':'0.0001','interval_hours':'8'},
          {'timestamp':(START+timedelta(hours=8,milliseconds=3)).isoformat(),'rate':'-0.0001','interval_hours':'8'}]
    report=liquidity.funding_grid_diagnostic(rows,START,END)
    assert report['nominal_unoccupied_slots']==88
    assert report['maximum_offset_after_nominal_slot_ms']==3
    assert not report['actual_payable_population_verified']
    assert not report['independent_historical_schedule_verified']
    with pytest.raises(ValueError):liquidity.funding_grid_diagnostic(rows[::-1],START,END)
    with pytest.raises(ValueError):liquidity.calendar(START+timedelta(days=1),END)


def source_fixture(root):
    hashes={}
    for symbol in ['BTCUSDT','ETHUSDT']:
        for directory,rows in [('bars',[bar(START+timedelta(hours=i*4)) for i in range(180)]),
                               ('funding_rates',[{'timestamp':START.isoformat(),'rate':'0.0001','interval_hours':'8'}])]:
            relative=f'observations/{directory}/{symbol}.csv'
            liquidity.csv_write(root/relative,rows,list(rows[0]))
            hashes[relative]=hashlib.sha256((root/relative).read_bytes()).hexdigest()
    (root/'integrity-crosscheck.json').write_text(json.dumps({'files_sha256':hashes}))
    return hashes


class FakeCapture:
    def __init__(self,root,missing=False):self.root,self.missing=root,missing
    def csv_archive(self,key):
        symbol=key.split('/')[-2] if '/metrics/' in key else key.split('/')[-3]
        receipt={'key':key,'status':'checksum_verified'}
        if '/metrics/' in key:
            if self.missing:return None,{'key':key,'status':'checksum_unavailable','http_status':404}
            t=liquidity.date(key[-14:-4])+timedelta(days=1)
            return metrics(t,symbol),receipt
        rows=[]
        for i in range(7):
            t=int((START-timedelta(hours=28)+timedelta(hours=i*4)).timestamp()*1000)
            rows.append({'open_time':str(t),'close_time':str(t+14399999),'open':'100','high':'101','low':'99','close':'100','volume':'1','quote_volume':'10.000000000000000001'})
        return rows,receipt


def test_collection_closes_observation_grid_but_never_creates_canonical_membership_or_funding(tmp_path):
    source=tmp_path/'original';source.mkdir();source_fixture(source)
    before={str(p):p.read_bytes() for p in source.rglob('*') if p.is_file()}
    out=tmp_path/'new';out.mkdir()
    report=liquidity.collect(FakeCapture(out),source,['BTCUSDT','ETHUSDT'],START,END,None,1)
    assert report['observation_grid_complete']
    assert report['received_observations']==10 and report['verified_archives']==12
    assert report['status']=='blocked' and not any(report['gates'].values())
    assert not report['research_run'] and not report['holdout_evaluated']
    assert not (out/'membership.csv').exists() and not (out/'funding').exists()
    assert before=={str(p):p.read_bytes() for p in source.rglob('*') if p.is_file()}
    rows=list(csv.DictReader((out/'observations/liquidity.csv').open()))
    assert {r['symbol'] for r in rows}=={'BTCUSDT','ETHUSDT'}


def test_missing_source_stays_unknown_and_pinned_input_changes_fail(tmp_path):
    source=tmp_path/'original';source.mkdir();hashes=source_fixture(source)
    out=tmp_path/'new';out.mkdir()
    report=liquidity.collect(FakeCapture(out,True),source,['BTCUSDT','ETHUSDT'],START,END,None,1)
    assert not report['observation_grid_complete'] and report['received_observations']==0
    assert len(report['failures'])==10
    relative='observations/bars/BTCUSDT.csv';(source/relative).write_text('changed')
    with pytest.raises(ValueError,match='checksum mismatch'):liquidity.pinned_rows(source,relative,hashes)
