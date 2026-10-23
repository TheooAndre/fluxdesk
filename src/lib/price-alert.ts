/** Equality has no direction; require a level on either side of the quote. */
export function priceAlertDirection(current: number, level: number): 'above' | 'below' | null {
  if (![current, level].every((n) => Number.isFinite(n) && n > 0 && n <= 1e15) || current === level)
    return null;
  return level > current ? 'above' : 'below';
}
