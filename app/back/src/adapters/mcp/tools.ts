import { McpServer, requireScopes } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { Actor } from "../../domain/types";
import { DomainValidationError } from "../../domain/errors";
import { AppError } from "../../application/errors";
import type { KakeiboUseCases } from "../../application/useCases";
import { requireAdmin } from "../auth/auth";
import type { KakeiboScope } from "../auth/scopes";
import {
  categorySchema, categoryUpdateSchema, categoryResultSchema,
  tagSchema, tagUpdateSchema, tagResultSchema, taxonomyResultSchema, deletionResultSchema,
  financialAssetSchema, financialAssetUpdateSchema, financialAssetResultSchema
} from "../contracts/resources";
import { entrySourceSchema, entrySourceResultSchema } from "../contracts/entrySources";
import { summaryFiltersSchema, insightEntriesSchema } from "../contracts/insights";

const idSchema = z.object({ id: z.string().min(1) });
const listSchema = z.object({ includeInactive: z.boolean().default(false) });
const userResultSchema = z.object({ id: z.string(), displayName: z.string(), role: z.enum(["admin", "member"]) });
const cashflowFields = { incomeTotal: z.number(), expenseTotal: z.number(), netCashflow: z.number(), currency: z.string() };
const monthResultSchema = z.object({ month: z.string(), ...cashflowFields });
const categorySummarySchema = z.object({ categoryId: z.string().nullable(), categoryName: z.string(), amount: z.number(), entryCount: z.number(), currency: z.string() });
const overviewResultSchema = z.object({
  from: z.string(), to: z.string(), ...cashflowFields,
  monthly: z.array(monthResultSchema),
  topExpenseCategories: z.array(categorySummarySchema),
  topTags: z.array(z.object({ tagId: z.string(), tagName: z.string(), amount: z.number(), entryCount: z.number(), currency: z.string() })),
  subjectUserTotals: z.array(z.object({ subjectUserId: z.string().nullable(), ...cashflowFields }))
});
const entryResultSchema = z.object({
  id: z.string(), entryType: z.enum(["expense", "income"]), entryDate: z.string(),
  amount: z.number(), currency: z.string()
}).passthrough();

export const serverInstructions = "家族の家計簿。分類前にgetTaxonomy、所有者を指定する前にlistUsersを呼ぶ。日付・金額が不明なら推測せず質問する。createEntrySourceは確認待ちの下書きを作る。確定は管理画面で行う。変更前に対象・変更内容を確認し、削除はIDと名前を提示して明示的な同意を得る。使用中のカテゴリ・タグと金融資産の削除は無効化になる。成功応答のIDと結果を確認して案内し、失敗した操作を成功扱いにしない。同じ取り込みの再送には同じidempotencyKeyを使う。";

export function createToolServer(useCases: KakeiboUseCases, actor: Actor, scopes: readonly string[], resource: string) {
  const server = new McpServer({ name: "zubora-kakeibo", version: "0.2.0" }, { instructions: serverInstructions });
  const read: KakeiboScope = "kakeibo:read";
  const taxonomy: KakeiboScope = "kakeibo:taxonomy:write";
  const assets: KakeiboScope = "kakeibo:assets:write";
  const importing: KakeiboScope = "kakeibo:import";

  function config(description: string, scope: KakeiboScope, destructive = false) {
    return {
      description,
      annotations: { readOnlyHint: scope === read, destructiveHint: destructive, idempotentHint: scope === read, openWorldHint: false },
      scopeChallenge: requireScopes(scope),
      _meta: { securitySchemes: [{ type: "oauth2", scopes: [scope] }] }
    };
  }

  async function invoke(scope: KakeiboScope, operation: () => Promise<object>) {
    if (!scopes.includes(scope)) {
      return {
        isError: true,
        content: [{ type: "text" as const, text: "追加の接続許可が必要です。" }],
        _meta: { "mcp/www_authenticate": [`Bearer resource_metadata="${new URL("/.well-known/oauth-protected-resource/mcp", resource)}", error="insufficient_scope", scope="${scope}"`] }
      };
    }
    try {
      if (scope === taxonomy) requireAdmin(actor);
      const data = await operation();
      return { content: [{ type: "text" as const, text: JSON.stringify(data) }], structuredContent: { ...data } };
    } catch (error) {
      if (error instanceof AppError || error instanceof DomainValidationError || error instanceof z.ZodError) {
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: error instanceof AppError ? error.code : "VALIDATION_ERROR", message: error.message }) }] };
      }
      console.error(JSON.stringify({ event: "mcp_tool_failed", errorType: error instanceof Error ? error.name : "unknown" }));
      return { isError: true, content: [{ type: "text" as const, text: "内部エラーが発生しました。操作結果を確認してから再実行してください。" }] };
    }
  }

  server.registerTool("getTaxonomy", {
    ...config("有効なカテゴリ・タグを取得する。管理用にはincludeInactiveで無効な分類も取得できる。", read),
    inputSchema: listSchema, outputSchema: taxonomyResultSchema
  }, ({ includeInactive }) => invoke(read, () => useCases.listTaxonomy(includeInactive)));

  server.registerTool("listUsers", {
    ...config("金融資産の所有者・明細の対象者として指定できる家族のIDと名前を取得する。", read),
    inputSchema: z.object({}), outputSchema: z.object({ items: z.array(userResultSchema) })
  }, () => invoke(read, async () => ({ items: (await useCases.listUsers()).map(({ id, displayName, role }) => ({ id, displayName, role })) })));

  server.registerTool("createEntrySource", {
    ...config("レシート等を確認待ちの下書きとして登録する。確定や集計反映は行わない。同じ再送には同じidempotencyKeyを指定する。", importing),
    inputSchema: entrySourceSchema.extend({ idempotencyKey: z.string().min(1).optional() }), outputSchema: entrySourceResultSchema
  }, ({ idempotencyKey, ...input }) => invoke(importing, () => useCases.createEntrySource(input, actor, idempotencyKey)));

  server.registerTool("getInsightOverview", {
    ...config("1461日以内の指定期間について、家計の概要を取得する。確認待ちの明細は含まない。", read),
    inputSchema: summaryFiltersSchema, outputSchema: overviewResultSchema
  }, (filters) => invoke(read, () => useCases.householdOverview(filters)));
  server.registerTool("getMonthlyInsights", {
    ...config("1461日以内の指定期間について月別の収支を取得する。", read),
    inputSchema: summaryFiltersSchema, outputSchema: z.object({ months: z.array(monthResultSchema) })
  }, (filters) => invoke(read, async () => ({ months: await useCases.monthlySummary(filters) })));
  server.registerTool("getCategoryInsights", {
    ...config("1461日以内の指定期間についてカテゴリ別集計を取得する。カテゴリ・タグ・対象者で絞り込める。", read),
    inputSchema: summaryFiltersSchema, outputSchema: z.object({ items: z.array(categorySummarySchema) })
  }, (filters) => invoke(read, async () => ({ items: await useCases.categorySummary(filters) })));
  server.registerTool("getInsightEntries", {
    ...config("400日以内の指定期間の確定明細を最大200件まで取得する。limitは必須。", read),
    inputSchema: insightEntriesSchema, outputSchema: z.object({ items: z.array(entryResultSchema) })
  }, (filters) => invoke(read, async () => ({ items: await useCases.insightEntries(filters) })));

  server.registerTool("createCategory", {
    ...config("支出または収入のカテゴリを登録する。管理者のみ利用できる。", taxonomy),
    inputSchema: categorySchema, outputSchema: categoryResultSchema
  }, (input) => invoke(taxonomy, () => useCases.createCategory(input, actor)));
  server.registerTool("updateCategory", {
    ...config("指定IDのカテゴリの指定した項目だけを変更する。管理者のみ利用できる。", taxonomy),
    inputSchema: categoryUpdateSchema.extend({ id: z.string().min(1) }), outputSchema: categoryResultSchema
  }, ({ id, ...patch }) => invoke(taxonomy, () => useCases.updateCategory(id, patch, actor)));
  server.registerTool("deleteCategory", {
    ...config("指定IDのカテゴリを削除する。使用中は履歴を保つため無効化し、modeで結果を返す。対象名・IDを提示し、削除の同意を得てから呼ぶ。管理者のみ。", taxonomy, true),
    inputSchema: idSchema, outputSchema: deletionResultSchema
  }, ({ id }) => invoke(taxonomy, () => useCases.deleteCategory(id, actor)));
  server.registerTool("createTag", {
    ...config("タグを登録する。管理者のみ利用できる。", taxonomy),
    inputSchema: tagSchema, outputSchema: tagResultSchema
  }, (input) => invoke(taxonomy, () => useCases.createTag(input)));
  server.registerTool("updateTag", {
    ...config("指定IDのタグの指定した項目だけを変更する。管理者のみ利用できる。", taxonomy),
    inputSchema: tagUpdateSchema.extend({ id: z.string().min(1) }), outputSchema: tagResultSchema
  }, ({ id, ...patch }) => invoke(taxonomy, () => useCases.updateTag(id, patch)));
  server.registerTool("deleteTag", {
    ...config("指定IDのタグを削除する。使用中は無効化し、modeで結果を返す。対象名・IDを提示し、削除の同意を得てから呼ぶ。管理者のみ。", taxonomy, true),
    inputSchema: idSchema, outputSchema: deletionResultSchema
  }, ({ id }) => invoke(taxonomy, () => useCases.deleteTag(id)));

  server.registerTool("listFinancialAssets", {
    ...config("金融資産を取得する。includeInactiveで無効化済みの資産も取得できる。", read),
    inputSchema: listSchema, outputSchema: z.object({ items: z.array(financialAssetResultSchema) })
  }, ({ includeInactive }) => invoke(read, async () => ({ items: await useCases.listFinancialAssets(includeInactive) })));
  server.registerTool("createFinancialAsset", {
    ...config("家族の金融資産を登録する。金額はcurrencyの最小通貨単位の整数、JPYなら円。所有者の省略時はログイン本人。", assets),
    inputSchema: financialAssetSchema, outputSchema: financialAssetResultSchema
  }, (input) => invoke(assets, () => useCases.createFinancialAsset(input, actor)));
  server.registerTool("updateFinancialAsset", {
    ...config("指定IDの金融資産の指定した項目だけを変更する。省略項目を初期値で上書きしない。", assets),
    inputSchema: financialAssetUpdateSchema.extend({ id: z.string().min(1) }), outputSchema: financialAssetResultSchema
  }, ({ id, ...patch }) => invoke(assets, () => useCases.updateFinancialAsset(id, patch, actor)));
  server.registerTool("deleteFinancialAsset", {
    ...config("指定IDの金融資産を無効化して有効な資産一覧から外す。物理削除しない。対象名・IDを提示し、削除の同意を得てから呼ぶ。", assets, true),
    inputSchema: idSchema, outputSchema: financialAssetResultSchema
  }, ({ id }) => invoke(assets, () => useCases.deleteFinancialAsset(id, actor)));
  return server;
}
