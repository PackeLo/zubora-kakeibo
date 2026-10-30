import { assertIsoDate } from "./dates";
import { createDedupeKey } from "./dedupe";
import { DomainValidationError } from "./errors";
import { assertPositiveAmount } from "./money";
import type { Entry } from "./types";

export type EntryEdit = Partial<Pick<Entry,
  "entryType" | "entryDate" | "amount" | "currency" | "subjectUserId" | "categoryId" | "target" | "memo"
>>;

export function editLedgerEntry(existing: Entry, patch: EntryEdit, expectedRevision: string): Entry | null {
  if (existing.archivedAt || existing.revision !== expectedRevision) return null;
  const values = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
  const next = { ...existing, ...values };
  assertIsoDate(next.entryDate, "entryDate");
  assertPositiveAmount(next.amount);
  if (!next.currency.trim()) throw new DomainValidationError("通貨を入力してね。");
  if (patch.subjectUserId !== undefined && !next.subjectUserId) throw new DomainValidationError("対象者を選んでね。");
  if (next.entryType === "expense" && !next.categoryId) throw new DomainValidationError("支出のカテゴリを選んでね。");
  return { ...next, revision: crypto.randomUUID(), dedupeKey: createDedupeKey(next.entryType, next.currency, next.amount) };
}
