import { z } from "zod";
import { daysBetween } from "../../domain/dates";
import { entryTypeSchema } from "./resources";

const periodFields = {
  from: z.iso.date(),
  to: z.iso.date(),
  type: entryTypeSchema.optional(),
  categoryIds: z.array(z.string()).optional(),
  tagIds: z.array(z.string()).optional(),
  excludedCategoryIds: z.array(z.string().min(1)).optional().describe("除外するカテゴリID。含める条件と重なった明細も除外する。"),
  excludedTagIds: z.array(z.string().min(1)).optional().describe("このタグIDのいずれかが付いた明細全体を除外する。タグなしは残す。"),
  subjectUserIds: z.array(z.string()).optional(),
  registeredByEmails: z.array(z.email()).optional()
};
function dateRange(maxDays: number) {
  return (value: { from: string; to: string }, ctx: z.RefinementCtx) => {
    if (value.from > value.to) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "from must be earlier than or equal to to" });
    } else if (daysBetween(value.from, value.to) > maxDays) {
      ctx.addIssue({ code: "custom", path: ["to"], message: `date range must be ${maxDays} days or less` });
    }
  };
}
export const summaryFiltersSchema = z.object(periodFields).superRefine(dateRange(1461));
export const insightEntriesSchema = z.object({
  ...periodFields,
  limit: z.number().int().min(1).max(200)
}).superRefine(dateRange(400));
