"""Explicit whole-instrument exclusions; standard library only, no strategy selection."""
from datetime import datetime


REASONS = frozenset({
    'delisted_contract', 'contract_migration', 'ticker_reuse',
    'missing_bars', 'invalid_bars', 'unverified_funding',
    'missing_membership', 'missing_liquidity_history', 'unverified_contract_identity',
})
SUBSET_WARNING = (
    'Retrospective data-quality subset: exclusions can introduce survivorship and '
    'availability bias. Results apply only to retained instruments, not the full historical market.'
)


def _utc(value):
    if not isinstance(value, str):
        raise ValueError('Scope timestamps require explicit UTC')
    stamp = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if stamp.tzinfo is None or stamp.utcoffset().total_seconds() != 0:
        raise ValueError('Scope timestamps require explicit UTC')
    return stamp


def universe_scope(manifest):
    """Validate a pre-result scope amendment, never infer exclusions from results.

    Omission preserves the original full historical universe requirement. A subset
    changes the population being studied; it does not certify retained funding/PIT.
    """
    scope = manifest.get('universe_scope')
    if scope is None:
        return {'mode': 'full_historical_universe', 'exclusions': [], 'warning': None,
                'full_historical_universe_in_scope': True}
    if not isinstance(scope, dict) or scope.get('mode') != 'data_quality_subset':
        raise ValueError('Unsupported universe scope')
    if (type(scope.get('policy_version')) is not int or scope['policy_version'] != 1
            or scope.get('selection_basis') != 'data_quality_only_before_strategy_evaluation'
            or scope.get('survivorship_bias_acknowledged') is not True):
        raise ValueError('Subset requires a versioned pre-result policy and bias acknowledgment')
    decided = _utc(scope.get('decided_at_utc'))
    exclusions = scope.get('exclusions')
    if not isinstance(exclusions, list) or not exclusions or len(exclusions) > 10000:
        raise ValueError('Subset requires a bounded explicit exclusion ledger')
    seen = set()
    for row in exclusions:
        if not isinstance(row, dict):
            raise ValueError('Invalid exclusion record')
        symbol = row.get('symbol')
        if (not isinstance(symbol, str) or not 1 <= len(symbol) <= 100
                or symbol != symbol.strip() or any(c in symbol for c in '/\\')
                or any(ord(c) < 32 for c in symbol) or symbol in seen):
            raise ValueError('Invalid or duplicate excluded instrument identity')
        seen.add(symbol)
        if row.get('reason_code') not in REASONS:
            raise ValueError('Exclusion must use a documented data-quality reason')
        if not all(isinstance(row.get(k), str) and row[k].strip() for k in ('reason', 'source')):
            raise ValueError('Each exclusion requires a reason and source evidence')
        if _utc(row.get('observed_at_utc')) > decided:
            raise ValueError('Exclusion evidence cannot postdate the scope decision')
    return {**scope, 'exclusions': sorted(exclusions, key=lambda r: r['symbol']),
            'warning': SUBSET_WARNING, 'full_historical_universe_in_scope': False}
