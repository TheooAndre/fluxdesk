"""Export existing results for FluxDesk. Never runs research or opens holdout."""
from __future__ import annotations
import argparse
from datetime import datetime
import json
from pathlib import Path


def utc(value: str) -> str:
    parsed = datetime.fromisoformat(value)
    if parsed.utcoffset() is None or parsed.utcoffset().total_seconds() != 0:
        raise ValueError('Report timestamps must be explicit UTC')
    return parsed.isoformat().replace('+00:00', 'Z')


def read(path: Path):
    if path.stat().st_size > 1_048_576:
        raise ValueError('Input report exceeds 1 MiB')
    return json.loads(path.read_text(), parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))


def bundle(folder: Path) -> dict:
    experiment = read(folder / 'experiment.json')
    if experiment.get('live_permission') is not False:
        raise ValueError('Only research-only experiments can be exported')

    def evaluation(name):
        summary = read(folder / f'{name}.json')
        folds = read(folder / f'{name}_folds.json')
        return {
            'sharpe': summary.get('sharpe'),
            'maxDrawdown': summary['max_drawdown'],
            'trades': summary.get('trades', 0),
            'costFraction': summary.get('total_cost_fraction', 0),
            'fundingFraction': summary.get('total_funding_fraction', 0),
            'trialsSearched': summary.get('trials_searched_total', 0),
            'deflatedSharpe': None,
            'folds': [{
                'start': utc(f['start']), 'end': utc(f['end']),
                'bars': f['bars'], 'selectedPairs': f['selected_pairs'],
                'sharpe': f.get('sharpe'), 'maxDrawdown': f['max_drawdown'],
                'trades': f.get('trades', 0),
            } for f in folds],
        }

    p = experiment['provenance']
    return {
        'schemaVersion': 1, 'engine': 'crypto-statarb-research@0.2.0',
        'fingerprint': experiment['fingerprint'],
        'datasetHash': p.get('sha256_input'),
        'synthetic': experiment['synthetic'], 'venue': p['venue'],
        'fundingComplete': p.get('funding_complete') is True,
        'pointInTimeUniverse': p.get('universe_point_in_time') is True,
        'holdoutOpened': experiment['holdout_opened'],
        'config': experiment['config'],
        'development': evaluation('development'),
        'holdout': evaluation('holdout') if experiment['holdout_opened'] else None,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('report_directory', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    payload = json.dumps(bundle(args.report_directory), indent=2, allow_nan=False)
    # Refuse accidental overwrite; exporting never changes experiment/holdout locks.
    with args.output.open('x') as handle:
        handle.write(payload + '\n')
