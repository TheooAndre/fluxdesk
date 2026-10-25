from dataclasses import asdict
import math

import pytest

from statarb.config import ResearchConfig, with_taker_fee_evidence


def evidence():
    return {'venue': 'binance', 'quote_currency': 'USDT', 'fee_evidence': {
        'source': 'Synthetic fixture; not account evidence', 'account_tier': 'fixture',
        'observed_at_utc': '2026-10-25T00:00:00Z', 'maker_bps': 2, 'taker_bps': 5,
        'venue': 'binance', 'quote_currency': 'USDT'}}


def test_real_cost_evidence_applies_taker_only_and_preserves_other_fixed_rules():
    base = ResearchConfig()
    actual = with_taker_fee_evidence(base, evidence())
    assert actual.fee_bps == 5
    assert base.fee_bps == 4
    old, new = asdict(base), asdict(actual)
    del old['fee_bps']; del new['fee_bps']
    assert old == new


@pytest.mark.parametrize('bad', [None, '5', True, math.nan, math.inf, -1, 101])
def test_rejects_missing_or_invalid_rates(bad):
    for field in ['maker_bps', 'taker_bps']:
        value = evidence(); value['fee_evidence'][field] = bad
        with pytest.raises(ValueError):
            with_taker_fee_evidence(ResearchConfig(), value)


@pytest.mark.parametrize('change', [
    {'source': ''}, {'account_tier': ''}, {'observed_at_utc': '2026-10-25'},
    {'observed_at_utc': '2026-10-25T10:00:00+01:00'}, {'venue': 'hyperliquid'}, {'quote_currency': 'USDC'},
])
def test_rejects_undated_or_wrong_scope_evidence(change):
    value = evidence(); value['fee_evidence'].update(change)
    with pytest.raises(ValueError):
        with_taker_fee_evidence(ResearchConfig(), value)


def test_missing_evidence_fails():
    with pytest.raises(ValueError, match='fee_evidence'):
        with_taker_fee_evidence(ResearchConfig(), {})


def test_cli_freezes_effective_taker_fee_without_running_research(tmp_path, monkeypatch):
    from statarb import cli
    from types import SimpleNamespace
    monkeypatch.setattr(cli, 'load_folder', lambda *_: SimpleNamespace(provenance={**evidence(), 'sha256_input': 'fixed-test-hash'}))
    seen = []
    def fake_run(_data, cfg, **_kwargs):
        seen.append(cfg.fee_bps)
        return {}
    monkeypatch.setattr(cli, 'run_research', fake_run)
    cli.main(['research', '--data', 'mocked', '--out', str(tmp_path / 'report')])
    import json
    frozen = json.loads((tmp_path / 'report/experiment.json').read_text())
    assert seen == [5]
    assert frozen['config']['fee_bps'] == 5
    assert frozen['provenance']['fee_evidence']['maker_bps'] == 2
    assert not frozen['holdout_opened']


def test_cli_missing_fee_evidence_fails_before_creating_report_or_simulating(tmp_path, monkeypatch):
    from statarb import cli
    from types import SimpleNamespace
    monkeypatch.setattr(cli, 'load_folder', lambda *_: SimpleNamespace(provenance={}))
    def forbidden_run(*_args, **_kwargs):
        raise AssertionError('No simulation may run without fee evidence')
    monkeypatch.setattr(cli, 'run_research', forbidden_run)
    out = tmp_path / 'must-not-exist'
    with pytest.raises(ValueError, match='fee_evidence'):
        cli.main(['research', '--data', 'mocked', '--out', str(out)])
    assert not out.exists()
