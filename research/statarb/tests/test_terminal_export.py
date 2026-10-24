"""Exporting is a passive read and must never open or invent a holdout."""
import importlib.util
import json
from pathlib import Path
import pytest

spec = importlib.util.spec_from_file_location('terminal_export', Path(__file__).parents[1] / 'export_terminal.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def test_export_keeps_empty_folds_and_never_modifies_experiment(tmp_path):
    experiment = {'live_permission': False, 'fingerprint': 'a'*64, 'synthetic': True,
                  'holdout_opened': False, 'config': {}, 'provenance': {'venue': 'SYNTHETIC'}}
    (tmp_path/'experiment.json').write_text(json.dumps(experiment))
    (tmp_path/'development.json').write_text(json.dumps({'max_drawdown': 0}))
    (tmp_path/'development_folds.json').write_text(json.dumps([
        {'start': '2023-01-01 00:00:00+00:00', 'end': '2023-01-30 20:00:00+00:00',
         'bars': 180, 'selected_pairs': [], 'max_drawdown': 0}]))
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    result = module.bundle(tmp_path)
    assert result['holdout'] is None and not result['holdoutOpened']
    assert result['development']['folds'][0]['selectedPairs'] == []
    assert result['development']['folds'][0]['sharpe'] is None
    assert result['development']['folds'][0]['start'] == '2023-01-01T00:00:00Z'
    assert before == {p.name: p.read_bytes() for p in tmp_path.iterdir()}


def test_export_refuses_ambiguous_time_and_nonfinite_metrics(tmp_path):
    with pytest.raises(ValueError):
        module.utc('2023-01-01T00:00:00')
    p = tmp_path/'bad.json'; p.write_text('{"sharpe":NaN}')
    with pytest.raises(ValueError):
        module.read(p)
