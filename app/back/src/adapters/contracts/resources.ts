import { z } from "zod";

export const entryTypeSchema = z.enum(["expense", "income"]);
export const sourceTypeSchema = z.enum(["manual", "receipt", "order_detail", "credit_card_statement", "bank_statement", "handwritten_note", "other"]);
export const assetTypeSchema = z.enum(["cash", "bank_deposit", "investment_trust", "stock", "crypto", "pension", "other"]);

const categoryFields = {
  code: z.string().trim().min(1),
  name: z.string().trim().min(1),
  kind: entryTypeSchema,
  sortOrder: z.number().int(),
  dedupeEnabled: z.boolean(),
  isActive: z.boolean()
};
export const categorySchema = z.object({
  ...categoryFields,
  sortOrder: categoryFields.sortOrder.default(0),
  dedupeEnabled: categoryFields.dedupeEnabled.default(true),
  isActive: categoryFields.isActive.default(true)
});
export const categoryUpdateSchema = z.object(categoryFields).partial();

const tagFields = { name: z.string().trim().min(1), isActive: z.boolean() };
export const tagSchema = z.object({ ...tagFields, isActive: tagFields.isActive.default(true) });
export const tagUpdateSchema = z.object(tagFields).partial();

const assetFields = {
  ownerUserId: z.string().min(1).nullable(),
  name: z.string().trim().min(1),
  assetType: assetTypeSchema,
  quantityText: z.string().nullable(),
  valuationMinor: z.number().int().nonnegative().nullable(),
  currency: z.string().trim().min(1),
  valuationNote: z.string().nullable()
};
export const financialAssetSchema = z.object({
  ...assetFields,
  ownerUserId: assetFields.ownerUserId.optional(),
  quantityText: assetFields.quantityText.optional(),
  valuationMinor: assetFields.valuationMinor.optional(),
  currency: assetFields.currency.default("JPY"),
  valuationNote: assetFields.valuationNote.optional()
});
export const financialAssetUpdateSchema = z.object(assetFields).partial();

export const categoryResultSchema = z.object({
  id: z.string(), ...categoryFields
}).passthrough();
export const tagResultSchema = z.object({ id: z.string(), ...tagFields }).passthrough();
export const financialAssetResultSchema = z.object({
  id: z.string(), ...assetFields, isActive: z.boolean()
}).passthrough();
export const taxonomyResultSchema = z.object({
  categories: z.array(categoryResultSchema),
  incomeCategories: z.array(categoryResultSchema),
  tags: z.array(tagResultSchema)
});
export const deletionResultSchema = z.object({
  mode: z.enum(["deleted", "deactivated"]),
  references: z.object({ entries: z.number(), entrySourceItems: z.number() })
});
