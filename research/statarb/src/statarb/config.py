from dataclasses import dataclass, replace
from datetime import datetime, timedelta
import math


@dataclass(frozen=True)
class ResearchConfig:
    timeframe_hours: int = 4
    formation_bars: int = 180 * 6
    test_bars: int = 30 * 6
    z_window: int = 90
    beta_refit_bars: int = 42
    entry_z: float = 2.0
    exit_z: float = 0.5
    stop_z: float = 4.0
    max_holding_bars: int = 90
    fdr_q: float = 0.10
    min_half_life: float = 2.0
    max_half_life: float = 90.0
    min_open_interest_usd: float = 5_000_000.0
    min_volume_24h_usd: float = 25_000_000.0
    fee_bps: float = 4.0
    base_slippage_bps: float = 2.0
    vol_slippage_factor: float = 0.1
    participation_impact_bps: float = 50.0
    target_vol_annual: float = 0.10
    max_pair_gross: float = 0.20
    max_asset_gross: float = 0.30
    max_portfolio_gross: float = 1.0
    max_drawdown: float = 0.10
    starting_equity: float = 10_000.0
    holdout_fraction: float = 0.30
    require_funding: bool = True
    require_point_in_time_universe: bool = True
    max_vol_regime_multiplier: float = 2.0
    random_seed: int = 7

    @property
    def bars_per_year(self) -> float:
        return 365 * 24 / self.timeframe_hours

    def __post_init__(self) -> None:
        if not (0 < self.exit_z < self.entry_z < self.stop_z):
            raise ValueError("Require 0 < exit_z < entry_z < stop_z")
        if not 0 < self.holdout_fraction < 0.5:
            raise ValueError("holdout_fraction must be in (0, 0.5)")
        if self.z_window < 20 or self.beta_refit_bars < 1 or self.formation_bars < self.z_window * 2:
            raise ValueError("Insufficient rolling/formation history")
        if self.fee_bps < 0 or self.base_slippage_bps < 0 or self.max_drawdown <= 0:
            raise ValueError("Invalid costs/risk parameters")


def with_taker_fee_evidence(cfg: ResearchConfig, provenance: dict) -> ResearchConfig:
    """Real research uses the declared account taker rate; synthetic defaults stay historical.

    This checks the supplied evidence's structure and instrument scope, not its
    independent authenticity or historical applicability. Maker fills are not modeled.
    """
    evidence = provenance.get("fee_evidence")
    if not isinstance(evidence, dict):
        raise ValueError("Real research requires dated account fee_evidence in manifest.json")
    for key in ("source", "account_tier"):
        if not isinstance(evidence.get(key), str) or not evidence[key].strip():
            raise ValueError("Fee evidence requires source and account tier")
    try:
        observed = datetime.fromisoformat(evidence["observed_at_utc"].replace("Z", "+00:00"))
        if observed.tzinfo is None or observed.utcoffset() != timedelta(0):
            raise ValueError("Fee evidence time requires explicit UTC")
    except (KeyError, TypeError, AttributeError, ValueError) as error:
        raise ValueError("Fee evidence requires a UTC observation/recording timestamp") from error
    for key in ("maker_bps", "taker_bps"):
        value = evidence.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not 0 <= value <= 100:
            raise ValueError("Fee rates must be finite numeric basis points in [0, 100]")
    for key in ("venue", "quote_currency"):
        if key in evidence and evidence[key] != provenance.get(key):
            raise ValueError("Fee evidence does not match the dataset " + key)
    return replace(cfg, fee_bps=float(evidence["taker_bps"]))
