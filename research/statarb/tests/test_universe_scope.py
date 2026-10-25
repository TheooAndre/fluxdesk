"""Exclusions change population, never repair funding or select on performance."""
import copy
import json
from types import SimpleNamespace

import pytest

from statarb.data import DataIntegrityError, load_folder
from statarb.universe import universe_scope
from test_input_audit import audit, fixture
from test_fee_evidence import evidence


def policy(symbol='C'):
    return {
        'mode': 'data_quality_subset', 'policy_version': 1,
        'decided_at_utc': '2026-10-25T12:00:00Z',
        'selection_basis': 'data_quality_only_before_strategy_evaluation',
        'survivorship_bias_acknowledged': True,
        'exclusions': [{'symbol': symbol, 'reason_code': 'contract_migration',
                        'reason': 'Synthetic fixture: retired contract, unusable source tails',
                        'source': 'Synthetic lifecycle evidence, not a market assertion',
                        'observed_at_utc': '2026-10-25T11:00:00Z'}],
    }


def amend(root, scope):
    path = root / 'manifest.json'
    manifest = json.loads(path.read_text())
    manifest['universe_scope'] = scope
    path.write_text(json.dumps(manifest))


def test_whole_asset_excluded_without_deleting_original_or_patching_rows(tmp_path):
    fixture(tmp_path)
    (tmp_path/'bars/C.csv').write_text('corrupt retired history retained verbatim')
    with (tmp_path/'membership.csv').open('a') as out:
        out.write('bad-date,C,true,true,USDT,unknown,unknown\n')
    amend(tmp_path, policy())
    before = {str(p.relative_to(tmp_path)): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}
    result = audit.audit_folder(tmp_path)
    assert result['status'] == 'structural_checks_only'
    assert result['issue_counts'] == {'data_quality_subset_bias': 1}
    assert result['excluded_bar_files_not_evaluated'] == ['C']
    data = load_folder(tmp_path)
    assert set(data.bars) == set(data.funding) == set(data.membership.symbol) == {'A', 'B'}
    assert data.provenance['effective_universe_scope']['full_historical_universe_in_scope'] is False
    assert before == {str(p.relative_to(tmp_path)): p.read_bytes() for p in tmp_path.rglob('*') if p.is_file()}


def test_excluding_retired_asset_never_clears_retained_missing_funding(tmp_path):
    fixture(tmp_path)
    amend(tmp_path, policy())
    (tmp_path/'funding/A.csv').unlink()
    assert audit.audit_folder(tmp_path)['issue_counts']['missing_or_invalid_funding'] == 1
    with pytest.raises(DataIntegrityError, match='funding series for A'):
        load_folder(tmp_path)


def test_exclusions_do_not_waive_funding_or_pit_assertions(tmp_path):
    fixture(tmp_path)
    amend(tmp_path, policy())
    path = tmp_path/'manifest.json'
    mf = json.loads(path.read_text())
    mf.update(funding_complete=False, universe_point_in_time=False)
    path.write_text(json.dumps(mf))
    result = audit.audit_folder(tmp_path)
    assert {'unverified_funding_complete', 'unverified_universe_point_in_time'} <= result['issue_counts'].keys()
    with pytest.raises(DataIntegrityError, match='Incomplete funding'):
        load_folder(tmp_path)


@pytest.mark.parametrize('key', ['funding_complete', 'universe_point_in_time'])
def test_subset_rejects_truthy_coverage_strings(tmp_path, key):
    fixture(tmp_path, 80)
    amend(tmp_path, policy())
    path = tmp_path/'manifest.json'
    mf = json.loads(path.read_text()); mf[key] = 'false'
    path.write_text(json.dumps(mf))
    with pytest.raises(DataIntegrityError):
        load_folder(tmp_path)


def test_undeclared_missing_active_asset_still_blocks(tmp_path):
    fixture(tmp_path)
    amend(tmp_path, policy())
    with (tmp_path/'membership.csv').open('a') as out:
        out.write('2022-01-01T00:00:00Z,D,true,true,USDT,10000000,50000000\n')
    assert audit.audit_folder(tmp_path)['issue_counts']['active_market_missing_history'] == 1
    with pytest.raises(DataIntegrityError, match='explicit exclusion: D'):
        load_folder(tmp_path)


def test_minimum_two_retained_histories_is_not_waived(tmp_path):
    fixture(tmp_path)
    amend(tmp_path, policy('B'))
    assert audit.audit_folder(tmp_path)['issue_counts']['requires_2_to_200_histories'] == 1
    with pytest.raises(DataIntegrityError, match='at least two'):
        load_folder(tmp_path)


@pytest.mark.parametrize('change', [
    {'survivorship_bias_acknowledged': False}, {'policy_version': True},
    {'selection_basis': 'remove_losing_pairs'}, {'exclusions': []},
    {'decided_at_utc': '2026-10-25'}, {'mode': 'current_survivors'},
])
def test_invalid_policy_fails_closed(tmp_path, change):
    fixture(tmp_path, 80)
    scope = policy(); scope.update(change)
    amend(tmp_path, scope)
    assert 'invalid_universe_scope' in audit.audit_folder(tmp_path)['issue_counts']
    with pytest.raises(DataIntegrityError, match='Invalid universe scope'):
        load_folder(tmp_path)


@pytest.mark.parametrize('change', [
    {'symbol': '../C'}, {'reason_code': 'low_sharpe'}, {'source': ''},
    {'observed_at_utc': '2026-10-26T00:00:00Z'},
])
def test_invalid_exclusion_evidence_rejected(change):
    scope = policy(); scope['exclusions'][0].update(change)
    with pytest.raises(ValueError):
        universe_scope({'universe_scope': scope})


def test_duplicate_exclusions_rejected_and_unicode_identity_preserved():
    scope = policy('测试USDT')
    assert universe_scope({'universe_scope': scope})['exclusions'][0]['symbol'] == '测试USDT'
    scope['exclusions'].append(copy.deepcopy(scope['exclusions'][0]))
    with pytest.raises(ValueError, match='duplicate'):
        universe_scope({'universe_scope': scope})


def test_scope_reason_changes_engine_and_audit_fingerprints(tmp_path):
    fixture(tmp_path, 80)
    scope = policy(); amend(tmp_path, scope)
    before = load_folder(tmp_path).provenance['sha256_input']
    before_audit = audit.audit_folder(tmp_path)['audit_input_sha256']
    scope['exclusions'][0]['reason'] = 'Amended source-only explanation'
    amend(tmp_path, scope)
    assert load_folder(tmp_path).provenance['sha256_input'] != before
    assert audit.audit_folder(tmp_path)['audit_input_sha256'] != before_audit


def test_cli_labels_every_report_and_freezes_scope_without_market_simulation(tmp_path, monkeypatch, capsys):
    from statarb import cli
    provenance = {**evidence(), 'sha256_input': 'synthetic-fixture-hash', 'universe_scope': policy()}
    monkeypatch.setattr(cli, 'load_folder', lambda *_: SimpleNamespace(provenance=provenance))
    evaluation = SimpleNamespace(statistics={'status': 'TEST_ONLY'}, net_returns=[], audits=[], simulations=[], fold_metrics=[])
    monkeypatch.setattr(cli, 'run_research', lambda *_a, **_kw: {'development': evaluation})
    seen = []
    monkeypatch.setattr(cli, 'save_report', lambda _out, _name, _ret, summary, *_a: seen.append(summary))
    out = tmp_path/'report'
    cli.main(['research', '--data', 'mocked', '--out', str(out)])
    assert seen[0]['universe_scope']['mode'] == 'data_quality_subset'
    assert 'survivorship' in capsys.readouterr().out
    frozen = json.loads((out/'experiment.json').read_text())
    assert frozen['provenance']['universe_scope'] == policy()
    assert frozen['holdout_opened'] is False


def test_omitting_scope_preserves_full_historical_requirement(tmp_path):
    fixture(tmp_path)
    with (tmp_path/'membership.csv').open('a') as out:
        out.write('2022-01-01T00:00:00Z,DELISTED,true,true,USDT,10000000,50000000\n')
    result = audit.audit_folder(tmp_path)
    assert result['universe_scope']['mode'] == 'full_historical_universe'
    assert 'active_market_missing_history' in result['issue_counts']
    with pytest.raises(DataIntegrityError, match='DELISTED'):
        load_folder(tmp_path)
