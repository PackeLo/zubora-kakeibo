import { z } from "zod";
import { entryTypeSchema, categoryResultSchema, tagResultSchema } from "./resources";

export const entryUpdateSchema = z.object({
  expectedRevision: z.string().min(1),
  entryType: entryTypeSchema.optional(),
  entryDate: z.iso.date().optional(),
  amount: z.number().int().positive().optional(),
  currency: z.string().trim().min(1).optional(),
  subjectUserId: z.string().min(1).optional(),
  categoryId: z.string().min(1).nullable().optional(),
  tagIds: z.array(z.string().min(1)).optional(),
  target: z.string().nullable().optional(),
  memo: z.string().nullable().optional()
}).strict();

export const ledgerEntryResultSchema = z.object({
  id: z.string(), revision: z.string(), entryType: entryTypeSchema, entryDate: z.string(),
  amount: z.number(), currency: z.string(), subjectUserId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(), target: z.string().nullable().optional(),
  memo: z.string().nullable().optional(), entrySourceId: z.string().nullable().optional(),
  entrySourceItemId: z.string().nullable().optional(), fixedAt: z.string().nullable().optional(),
  category: categoryResultSchema.nullable().optional(), tags: z.array(tagResultSchema),
  registeredBy: z.object({ email: z.string(), displayName: z.string() }).nullable().optional()
});
