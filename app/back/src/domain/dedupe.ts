import type { EntryType } from "./types";

export function createDedupeKey(entryType: EntryType, currency: string, amount?: number | null): string | null {
  if (amount == null || !Number.isInteger(amount)) return null;
  return `${entryType}:${currency}:${amount}`;
}

export function duplicatePairKey(entrySourceItemId: string, entryId: string): string {
  return [entrySourceItemId, entryId].sort().join(":");
}

export function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLocaleLowerCase("ja-JP");
}

export function textSimilarityScore(a: string | null | undefined, b: string | null | undefined): number {
  const left = normalizeText(a);
  const right = normalizeText(b);
  if (!left || !right) return 0;
  if (left === right) return 20;
  if (left.includes(right) || right.includes(left)) return 12;
  const leftTokens = new Set(left.split(/[\s,、。・/]+/).filter(Boolean));
  const rightTokens = new Set(right.split(/[\s,、。・/]+/).filter(Boolean));
  let matched = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) matched += 1;
  }
  return matched > 0 ? Math.min(10, matched * 3) : 0;
}
