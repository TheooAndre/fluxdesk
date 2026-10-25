import type { JournalDay, JournalTrade } from './model.ts';

export const TRADE_DRAFT_KEY = 'fluxdesk.journal.draft.v1';
export const JOURNAL_SAVED = 'fluxdesk:journal-saved';
export type TradeDraft = JournalTrade & { deviceDraftId: string };
export type JournalSaved =
  | { kind: 'trade'; submitted: TradeDraft; saved: JournalTrade }
  | { kind: 'day'; submitted: JournalDay; saved: JournalDay };
export const asDraft = (trade: JournalTrade): TradeDraft => ({
  ...trade,
  deviceDraftId: crypto.randomUUID(),
});

/** Apply a receipt only to the draft it saved; preserve later edits with the new revision. */
export function reconcileTradeDraft(
  current: TradeDraft | null,
  submitted: TradeDraft,
  saved: JournalTrade,
): TradeDraft | null {
  if (!current || current.deviceDraftId !== submitted.deviceDraftId) return current;
  if (JSON.stringify(current) === JSON.stringify(submitted)) return null;
  return {
    ...current,
    id: saved.id,
    revision: saved.revision,
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  };
}
export function reconcileDayDraft(
  current: JournalDay | null,
  submitted: JournalDay,
  saved: JournalDay,
): JournalDay | null {
  if (!current || current.date !== submitted.date || current.revision !== submitted.revision) return current;
  if (JSON.stringify(current) === JSON.stringify(submitted)) return null;
  return { ...current, revision: saved.revision, updatedAt: saved.updatedAt };
}
