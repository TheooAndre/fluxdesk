"""Strict, point-in-time research data validation; no API credentials or guessing."""
from __future__ import annotations
from dataclasses import dataclass
from pathlib import Path
import hashlib
import json
import numpy as np
import pandas as pd
from .universe import universe_scope

REQUIRED = ("open", "high", "low", "close", "volume")


class DataIntegrityError(RuntimeError):
    """Invalid/insufficient input: fail closed, don't generate orders."""


@dataclass
class ResearchData:
    bars: dict[str, pd.DataFrame]
    funding: dict[str, pd.Series]
    membership: pd.DataFrame
    provenance: dict

    @property
    def index(self) -> pd.DatetimeIndex:
        """Common venue timeline, including times when a contract did not exist."""
        timestamps = pd.DatetimeIndex(sorted(set().union(*(set(df.index) for df in self.bars.values()))))
        return timestamps


def validate_bars(frame: pd.DataFrame, timeframe_hours: int = 4) -> pd.DataFrame:
    df = frame.copy()
    if "timestamp" in df.columns:
        df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
        df = df.set_index("timestamp")
    if not isinstance(df.index, pd.DatetimeIndex):
        raise DataIntegrityError("OHLCV requires timestamp column or DatetimeIndex")
    if df.index.tz is None:
        raise DataIntegrityError("OHLCV timestamps must specify UTC timezone")
    df = df.sort_index()
    if df.index.has_duplicates:
        raise DataIntegrityError("Duplicate OHLCV timestamps")
    if not set(REQUIRED).issubset(df.columns):
        raise DataIntegrityError("Missing OHLCV open/high/low/close/volume")
    df = df.loc[:, REQUIRED].astype(float)
    if not np.isfinite(df.to_numpy()).all() or (df[list(REQUIRED[:4])] <= 0).any().any():
        raise DataIntegrityError("Nonpositive/nonfinite prices")
    if (df.volume <= 0).any():
        raise DataIntegrityError("Zero or negative bar volume; missing bars must not be forward-filled")
    if (df.high < df[["open", "close", "low"]].max(axis=1)).any() or (df.low > df[["open", "close", "high"]].min(axis=1)).any():
        raise DataIntegrityError("Invalid OHLC high/low relationships")
    # Venue-API timestamps typically represent the candle START, UTC.
    gap = pd.Timedelta(hours=timeframe_hours)
    if len(df) > 1 and not (df.index.to_series().diff().iloc[1:] == gap).all():
        raise DataIntegrityError("Missing/noncontiguous bars; no synthetic forward fill")
    return df


def load_folder(folder: str | Path, timeframe_hours: int = 4) -> ResearchData:
    """Load CSV panels plus mandatory manifest and historical membership snapshots.

    manifest.json: {"venue": "binance", "contract_type": "linear_perpetual",
      "quote_currency": "USDT", "funding_complete": true, "universe_point_in_time": true}
    membership.csv: timestamp,symbol,active,linear,quote; one full snapshot per decision date.
    """
    root = Path(folder)
    mf = root / "manifest.json"
    if not mf.exists():
        raise DataIntegrityError("Missing manifest.json with provenance and funding coverage")
    provenance = json.loads(mf.read_text())
    if not isinstance(provenance, dict):
        raise DataIntegrityError('Manifest must be an object')
    try:
        scope = universe_scope(provenance)
    except (ValueError, TypeError) as exc:
        raise DataIntegrityError(f'Invalid universe scope: {exc}') from exc
    excluded = {row['symbol'] for row in scope['exclusions']}
    provenance['effective_universe_scope'] = scope
    if provenance.get("contract_type") != "linear_perpetual" or provenance.get("quote_currency") not in ("USDT", "USDC", "USD"):
        raise DataIntegrityError("Only single-venue USD-quoted linear perpetuals supported")
    if provenance.get("funding_complete") is not True:
        raise DataIntegrityError("Incomplete funding data: backtest cannot claim net executable results")
    if provenance.get("universe_point_in_time") is not True:
        raise DataIntegrityError("Need historical membership incl. delisted markets, not today's universe")
    member_path = root / "membership.csv"
    if not member_path.exists():
        raise DataIntegrityError("Missing point-in-time membership.csv")
    mem = pd.read_csv(member_path)
    if not {"timestamp", "symbol", "active", "linear", "quote", "open_interest_usd", "volume_24h_usd"}.issubset(mem.columns):
        raise DataIntegrityError("Invalid membership columns")
    mem = mem.loc[~mem.symbol.isin(excluded)].copy()
    if mem.empty:
        raise DataIntegrityError('No retained PIT membership after exclusions')
    mem["timestamp"] = pd.to_datetime(mem.timestamp, utc=True)
    if mem.timestamp.isna().any():
        raise DataIntegrityError("Invalid membership timestamps")
    bars, funding = {}, {}
    for path in sorted((root / "bars").glob("*.csv")):
        sym = path.stem
        if sym in excluded:
            continue
        bars[sym] = validate_bars(pd.read_csv(path), timeframe_hours)
        fpath = root / "funding" / f"{sym}.csv"
        if not fpath.exists():
            raise DataIntegrityError(f"No funding series for {sym}")
        fd = pd.read_csv(fpath)
        if not {"timestamp", "rate"}.issubset(fd.columns):
            raise DataIntegrityError(f"Funding columns missing for {sym}")
        ts = pd.to_datetime(fd.timestamp, utc=True)
        f = pd.Series(fd.rate.astype(float).to_numpy(), index=ts).sort_index()
        if f.index.has_duplicates or not np.isfinite(f.to_numpy()).all():
            raise DataIntegrityError(f"Invalid funding records for {sym}")
        funding[sym] = f
    if len(bars) < 2:
        raise DataIntegrityError("Need at least two OHLCV asset histories")
    # Undeclared omissions must not silently disappear at the selector's intersection.
    active = mem.active.astype(str).str.lower().isin(['true', '1'])
    missing = set(mem.loc[active, 'symbol']) - set(bars)
    if missing:
        raise DataIntegrityError('Active markets lack history or explicit exclusion: ' + ', '.join(sorted(missing)))
    used = [mf, member_path] + [root/d/f'{s}.csv' for s in bars for d in ('bars', 'funding')]
    hashes = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in used}
    # Include policy/fee evidence and filenames, not just concatenated CSV contents.
    provenance['files_sha256'] = hashes
    provenance["sha256_input"] = hashlib.sha256(json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    return ResearchData(bars=bars, funding=funding, membership=mem, provenance=provenance)


def eligible_at(data: ResearchData, decision_ts: pd.Timestamp, *,
                min_open_interest_usd: float = 5_000_000.0,
                min_volume_24h_usd: float = 25_000_000.0) -> list[str]:
    """Use latest historical FULL snapshot as known by decision timestamp."""
    m = data.membership[data.membership.timestamp <= decision_ts]
    if m.empty:
        raise DataIntegrityError("No PIT universe snapshot predating formation decision")
    latest = m.timestamp.max()
    # Research policy: snapshot older than seven days is stale, fail closed.
    if decision_ts - latest > pd.Timedelta(days=7):
        raise DataIntegrityError("PIT market universe snapshot is stale (>7 days)")
    snapshot = m[m.timestamp == latest]
    needed = {"open_interest_usd", "volume_24h_usd"}
    if not needed.issubset(snapshot.columns):
        raise DataIntegrityError("PIT snapshot requires historical USD OI and 24h volume")
    good = snapshot[(snapshot.active.astype(bool)) & (snapshot.linear.astype(bool)) &
                    (snapshot.quote == data.provenance["quote_currency"]) &
                    (snapshot.open_interest_usd >= min_open_interest_usd) &
                    (snapshot.volume_24h_usd >= min_volume_24h_usd)]
    return sorted(set(good.symbol) & set(data.bars))


def common_bars(data: ResearchData, a: str, b: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    x, y = data.bars[a], data.bars[b]
    if not x.index.equals(y.index):
        raise DataIntegrityError(f"Misaligned or missing bar {a}/{b}; no forward-fill")
    return x, y
