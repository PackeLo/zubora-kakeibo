import { z } from "zod";
import { entryTypeSchema } from "../contracts/resources";
export {
  entryTypeSchema, sourceTypeSchema, assetTypeSchema,
  categorySchema, categoryUpdateSchema, tagSchema, tagUpdateSchema,
  financialAssetSchema, financialAssetUpdateSchema
} from "../contracts/resources";
export { entrySourceSchema } from "../contracts/entrySources";

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
  tagsJson: z.string().refine((value) => {
    try {
      const tags: unknown = JSON.parse(value);
      return Array.isArray(tags) && tags.every((tag) => typeof tag === "string");
    } catch {
      return false;
    }
  }, "tagsJson must be a JSON array of tag names").nullable().optional(),
  memo: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1).nullable().optional()
});

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
