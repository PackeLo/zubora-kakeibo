import { z } from "zod";

export const entryTypeSchema = z.enum(["expense", "income"]);
export const sourceTypeSchema = z.enum(["manual", "receipt", "order_detail", "credit_card_statement", "bank_statement", "handwritten_note", "other"]);
export const assetTypeSchema = z.enum(["cash", "bank_deposit", "investment_trust", "stock", "crypto", "pension", "other"]);

export const actionEntrySourceSchema = z.object({
  sourceType: sourceTypeSchema,
  displayName: z.string().nullable().optional(),
  sourceFileName: z.string().nullable().optional(),
  sourceSha256: z.string().nullable().optional(),
  rawInputSummary: z.string().nullable().optional(),
  rawText: z.string().nullable().optional(),
  rawPayloadJson: z.unknown().optional(),
  items: z
    .array(
      z.object({
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
      })
    )
    .min(1)
});

export const postEntrySourceItemSchema = z.object({
  entryType: entryTypeSchema,
  entryDate: z.string(),
  amount: z.number().int().positive(),
  currency: z.string().default("JPY"),
  subjectUserId: z.string(),
  categoryId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).default([]),
  target: z.string().nullable().optional(),
  memo: z.string().nullable().optional()
});

export const manualEntrySchema = postEntrySourceItemSchema.extend({
  sourceDisplayName: z.string().nullable().optional()
});

export const entryUpdateSchema = z.object({
  entryType: entryTypeSchema.optional(),
  entryDate: z.string().optional(),
  amount: z.number().int().positive().optional(),
  currency: z.string().optional(),
  subjectUserId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  tagIds: z.array(z.string()).optional(),
  target: z.string().nullable().optional(),
  memo: z.string().nullable().optional()
});

export const categorySchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  kind: entryTypeSchema,
  sortOrder: z.number().int().default(0),
  dedupeEnabled: z.boolean().default(true),
  isActive: z.boolean().default(true)
});

export const categoryUpdateSchema = categorySchema.partial();

export const tagSchema = z.object({
  name: z.string().min(1),
  isActive: z.boolean().default(true)
});

export const tagUpdateSchema = tagSchema.partial();

export const entrySourceUpdateSchema = z.object({
  displayName: z.string().nullable().optional(),
  sourceFileName: z.string().nullable().optional(),
  rawInputSummary: z.string().nullable().optional(),
  rawText: z.string().nullable().optional()
});

export const entrySourceItemUpdateSchema = z.object({
  entryType: entryTypeSchema.optional(),
  subjectUserId: z.string().nullable().optional(),
  entryDate: z.string().nullable().optional(),
  amount: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().optional(),
  target: z.string().nullable().optional(),
  categoryIdGuess: z.string().nullable().optional(),
  categoryNameGuess: z.string().nullable().optional(),
  tagsJson: z.string().nullable().optional(),
  memo: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional()
});

export const financialAssetSchema = z.object({
  ownerUserId: z.string().nullable().optional(),
  name: z.string().min(1),
  assetType: assetTypeSchema,
  quantityText: z.string().nullable().optional(),
  valuationMinor: z.number().int().nonnegative().nullable().optional(),
  currency: z.string().default("JPY"),
  valuationNote: z.string().nullable().optional()
});

export const financialAssetUpdateSchema = financialAssetSchema.partial();

export const markNotDuplicateSchema = z.object({
  entryId: z.string(),
  reason: z.string().nullable().optional()
});

export const confirmExternalBackupSchema = z.object({
  exportId: z.string(),
  contentSha256: z.string(),
  externalStorageNote: z.string().nullable().optional()
});

export function parseCsv(value: string | undefined | null): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseNumber(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
