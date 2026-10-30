import { assertIsoDate } from "./dates";
import { createDedupeKey } from "./dedupe";
import { DomainValidationError } from "./errors";
import { assertNullableAmount } from "./money";
import type { EntrySourceItem } from "./types";

export type SourceItemDraftPatch = Partial<Pick<EntrySourceItem,
  "entryType" | "subjectUserId" | "entryDate" | "amount" | "currency" | "target" |
  "categoryIdGuess" | "categoryNameGuess" | "tagsJson" | "memo" | "confidence"
>>;

export function editPendingSourceItem(item: EntrySourceItem, patch: SourceItemDraftPatch, now: string): EntrySourceItem | null {
  if (item.status !== "pending") return null;
  const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const next = { ...item, ...defined };
  if (next.entryDate != null) assertIsoDate(next.entryDate, "entryDate");
  assertNullableAmount(next.amount);
  if (!next.currency.trim()) throw new DomainValidationError("通貨を入力してね。");
  return {
    ...next,
    dedupeKey: createDedupeKey(next.entryType, next.currency, next.amount),
    updatedAt: new Date(Math.max(Date.parse(now), Date.parse(item.updatedAt) + 1)).toISOString()
  };
}

export function canAutomaticallyPost(item: EntrySourceItem): boolean {
  return item.status === "pending" && item.confidence != null && item.confidence > 0.95;
}
