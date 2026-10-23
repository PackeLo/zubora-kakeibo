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
