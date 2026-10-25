import { expect, it } from 'vitest';
import { newTrade } from '../src/journal/model.ts';
import { asDraft, reconcileTradeDraft, reconcileDayDraft } from '../src/journal/drafts.ts';
it('clears only the submitted draft, preserves subsequent edits and rebases a new trade to its saved identity', () => {
  const submitted = asDraft(newTrade('2026-10-25'));
  const saved = { ...submitted, id: 'server-id', revision: 1, createdAt: 100, updatedAt: 100 };
  expect(reconcileTradeDraft(structuredClone(submitted), submitted, saved)).toBeNull();
  const changed = { ...submitted, title: 'Edited during save', review: 'Keep this' };
  expect(reconcileTradeDraft(changed, submitted, saved)).toEqual({
    ...changed,
    id: 'server-id',
    revision: 1,
    createdAt: 100,
    updatedAt: 100,
  });
  const replacement = asDraft(newTrade('2026-10-25'));
  expect(reconcileTradeDraft(replacement, submitted, saved)).toBe(replacement);
  expect(reconcileTradeDraft(null, submitted, saved)).toBeNull();
});
it('keeps a different daily draft and advances later edits to the confirmed revision', () => {
  const submitted = {
    date: '2026-10-25',
    revision: 2,
    plan: 'Original',
    review: '',
    mood: '',
    lessons: '',
    updatedAt: 100,
  };
  const saved = { ...submitted, revision: 3, updatedAt: 200 };
  expect(reconcileDayDraft({ ...submitted }, submitted, saved)).toBeNull();
  const changed = { ...submitted, plan: 'New edits' };
  expect(reconcileDayDraft(changed, submitted, saved)).toEqual({ ...changed, revision: 3, updatedAt: 200 });
  const other = { ...changed, date: '2026-10-26' };
  expect(reconcileDayDraft(other, submitted, saved)).toBe(other);
  const newerRevision = { ...changed, revision: 4 };
  expect(reconcileDayDraft(newerRevision, submitted, saved)).toBe(newerRevision);
});
