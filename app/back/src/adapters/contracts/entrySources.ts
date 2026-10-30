import { z } from "zod";
import { entryTypeSchema, sourceTypeSchema } from "./resources";

export const entrySourceSchema = z.object({
  sourceType: sourceTypeSchema,
  displayName: z.string().nullable().optional(),
  sourceFileName: z.string().nullable().optional(),
  sourceSha256: z.string().nullable().optional(),
  rawInputSummary: z.string().nullable().optional(),
  rawText: z.string().nullable().optional(),
  rawPayloadJson: z.unknown().optional(),
  items: z.array(z.object({
    entryType: entryTypeSchema,
    subjectUserId: z.string().nullable().optional(),
    entryDate: z.string().nullable().optional(),
    amount: z.number().int().nonnegative().nullable().optional(),
    currency: z.string().default("JPY"),
    target: z.string().nullable().optional(),
    categoryCodeGuess: z.string().nullable().optional(),
    categoryNameGuess: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    memo: z.string().nullable().optional()
  })).min(1)
});
export const entrySourceResultSchema = z.object({
  entrySourceId: z.string(),
  createdEntrySourceItemIds: z.array(z.string()),
  status: z.string()
});

export const sourceItemFiltersSchema = z.object({
  status: z.enum(["pending", "posted"]).default("pending"),
  type: entryTypeSchema.optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  entrySourceId: z.string().min(1).optional()
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "from must be earlier than or equal to to", path: ["to"] });

export const sourceItemPatchSchema = z.object({
  entryType: entryTypeSchema.optional(),
  subjectUserId: z.string().min(1).nullable().optional(),
  entryDate: z.iso.date().nullable().optional(),
  amount: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().trim().min(1).optional(),
  target: z.string().nullable().optional(),
  categoryIdGuess: z.string().min(1).nullable().optional(),
  categoryNameGuess: z.string().nullable().optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  memo: z.string().nullable().optional()
}).strict();

export const sourceItemResultSchema = z.object({
  id: z.string(), entrySourceId: z.string(), itemIndex: z.number().int(),
  entryType: entryTypeSchema, subjectUserId: z.string().nullable(),
  entryDate: z.string().nullable(), amount: z.number().nullable(), currency: z.string(),
  target: z.string().nullable(), categoryIdGuess: z.string().nullable(), categoryNameGuess: z.string().nullable(),
  tags: z.array(z.string()).nullable(), memo: z.string().nullable(), confidence: z.number().nullable(),
  status: z.enum(["pending", "posted"]), postedEntryId: z.string().nullable(),
  createdAt: z.string(), updatedAt: z.string()
});

export function sourceItemResult(item: import("../../domain/types").EntrySourceItem) {
  let tags: string[] | null = null;
  const parsed = z.array(z.string()).safeParse(safelyParseJson(item.tagsJson ?? "[]"));
  if (parsed.success) tags = parsed.data;
  const { tagsJson: _tagsJson, dedupeKey: _dedupeKey, ...values } = item;
  return { ...values, subjectUserId: item.subjectUserId ?? null, entryDate: item.entryDate ?? null,
    amount: item.amount ?? null, target: item.target ?? null, categoryIdGuess: item.categoryIdGuess ?? null,
    categoryNameGuess: item.categoryNameGuess ?? null, tags, memo: item.memo ?? null,
    confidence: item.confidence ?? null, postedEntryId: item.postedEntryId ?? null };
}

function safelyParseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}
