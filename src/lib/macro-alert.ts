export const MACRO_LEAD_MINUTES = [5, 15, 30, 60, 120, 240, 720, 1440] as const;
export type MacroLeadMinutes = (typeof MACRO_LEAD_MINUTES)[number];

export function macroLeadLabel(minutes: number) {
  return minutes === 1440 ? '1 day before' : minutes >= 60 ? `${minutes / 60}h before` : `${minutes}m before`;
}

/** A release flag or a placeholder is not a published numerical observation. Zero is valid. */
export function hasMacroActual(value: string) {
  const text = value.trim();
  return /\d/.test(text) && !/^(pending|not\s|n\/?a\b|tbd\b|tba\b|null\b|unavailable|forecast)/i.test(text);
}
