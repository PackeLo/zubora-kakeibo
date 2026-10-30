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
import {
  entrySourceSchema, entrySourceResultSchema, sourceItemFiltersSchema,
  sourceItemPatchSchema, sourceItemResultSchema, sourceItemResult
} from "../contracts/entrySources";
import { summaryFiltersSchema, insightEntriesSchema } from "../contracts/insights";
import { entryUpdateSchema, ledgerEntryResultSchema } from "../contracts/entries";

const idSchema = z.object({ id: z.string().min(1) });
const listSchema = z.object({ includeInactive: z.boolean().default(false) });
const userResultSchema = z.object({ id: z.string(), email: z.string(), displayName: z.string(), role: z.enum(["admin", "member"]) });
const profileResultSchema = z.object({ email: z.string(), displayName: z.string() });
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

export const serverInstructions = "家族の家計簿。確定済み明細はgetInsightEntriesで探し、getEntryで最新値とrevisionを取得し、updateEntryにexpectedRevisionと変更項目だけを渡して編集する。確定済み編集に信頼度の制限はない。競合時は再取得して他の変更を確認し、上書きしない。元明細は取り込み・確定時の記録であり、現在の台帳はgetEntryで確認する。分類前にgetTaxonomy、対象者を指定する前にlistUsersを呼ぶ。日付・金額・対象者が不明なら推測せず質問する。createEntrySourceは確認待ちの下書きを作る。listEntrySourceItemsとgetEntrySourceItemで既存明細を取得し、updateEntrySourceItemで分類・タグ等を修正できる。tagsは登録済みタグ名の配列で、空配列は全解除、省略は維持。カテゴリはcategoryIdGuessに実際のIDを指定する。信頼度95%超で必要項目が揃う明細はpostEntrySourceItemで自動確定してよい。95%ちょうど以下・不明は管理画面の登録元明細で人間が確認して確定する。重複・必須不足などで確定が拒否されたら確認待ちに残し理由を伝える。信頼度を正答率の保証と説明しない。変更前に対象と内容を確認するが、95%超の確定で毎回ユーザーの承認を要求しない。削除はIDと名前を提示して明示的な同意を得る。使用中のカテゴリ・タグと金融資産の削除は無効化になる。成功応答のIDと結果を確認して案内し、下書きを確定済みと説明しない。同じ取り込みの再送には同じidempotencyKeyを使う。";

export function createToolServer(useCases: KakeiboUseCases, actor: Actor, scopes: readonly string[], resource: string) {
  const server = new McpServer({ name: "zubora-kakeibo", version: "0.2.0" }, { instructions: serverInstructions });
  const read: KakeiboScope = "kakeibo:read";
  const taxonomy: KakeiboScope = "kakeibo:taxonomy:write";
  const assets: KakeiboScope = "kakeibo:assets:write";
  const importing: KakeiboScope = "kakeibo:import";
  const drafts: KakeiboScope = "kakeibo:drafts:write";
  const posting: KakeiboScope = "kakeibo:entries:post";
  const editing: KakeiboScope = "kakeibo:entries:write";

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
    ...config("家族のID・正式名・正規メールを取得する。対象者はID、登録者検索のregisteredByEmailsは正規メールを使う。profilesは表示名の設定で、未ログインの人の利用権限を表さない。", read),
    inputSchema: z.object({}), outputSchema: z.object({ items: z.array(userResultSchema), profiles: z.array(profileResultSchema) })
  }, () => invoke(read, async () => ({ items: await useCases.listUsers(), profiles: useCases.householdProfiles() })));

  server.registerTool("createEntrySource", {
    ...config("レシート等を確認待ちの下書きとして登録する。確定や集計反映は行わない。同じ再送には同じidempotencyKeyを指定する。", importing),
    inputSchema: entrySourceSchema.extend({ idempotencyKey: z.string().min(1).optional() }), outputSchema: entrySourceResultSchema
  }, ({ idempotencyKey, ...input }) => invoke(importing, () => useCases.createEntrySource(input, actor, idempotencyKey)));

  server.registerTool("listEntrySourceItems", {
    ...config("取り込み済みの明細を取得する。既定は確認待ち。status、期間、種別、entrySourceIdで絞り込める。確認待ちは集計に含まれない。", read),
    inputSchema: sourceItemFiltersSchema, outputSchema: z.object({ items: z.array(sourceItemResultSchema) })
  }, (filters) => invoke(read, async () => ({ items: (await useCases.listEntrySourceItems(filters)).map(sourceItemResult) })));

  server.registerTool("getEntrySourceItem", {
    ...config("IDを指定して取り込み明細の現在値・タグ・信頼度・確定ステータスを取得する。", read),
    inputSchema: idSchema, outputSchema: sourceItemResultSchema
  }, ({ id }) => invoke(read, async () => sourceItemResult(await useCases.getEntrySourceItem(id))));

  server.registerTool("updateEntrySourceItem", {
    ...config("確認待ち明細だけを部分編集する。tagsはタグ名の配列。省略は維持、nullや空配列は解除。categoryIdGuessはカテゴリID。確定や集計反映は行わず、信頼度は変更できない。", drafts),
    inputSchema: sourceItemPatchSchema.extend({ id: z.string().min(1) }), outputSchema: sourceItemResultSchema
  }, ({ id, ...patch }) => invoke(drafts, async () => sourceItemResult(await useCases.updateEntrySourceItem(id, patch))));

  server.registerTool("postEntrySourceItem", {
    ...config("保存済みの確認待ち明細を検証して確定し、集計へ反映する。信頼度95%超・必須項目と分類が有効・重複候補なしの場合だけ実行できる。成功した同じIDの再送は元の確定結果を返す。低信頼度は管理画面で確認する。", posting),
    inputSchema: idSchema, outputSchema: entryResultSchema
  }, ({ id }) => invoke(posting, () => useCases.postHighConfidenceSourceItem(id, actor)));

  server.registerTool("getEntry", {
    ...config("確定済みの家計簿明細をIDで取得する。現在値・分類・タグ・revisionを確認してから編集する。元明細の候補値は台帳の現在値とは異なる場合がある。", read),
    inputSchema: idSchema, outputSchema: ledgerEntryResultSchema
  }, ({ id }) => invoke(read, () => useCases.getEntry(id)));

  server.registerTool("updateEntry", {
    ...config("確定済み明細を同じIDのまま部分編集し集計に反映する。getEntryで得たrevisionをexpectedRevisionに指定する。省略は維持、tagIds空配列は全解除。競合時は再取得し、他の変更を勝手に上書きしない。信頼度95%の制限はない。", editing),
    inputSchema: entryUpdateSchema.extend({ id: z.string().min(1) }), outputSchema: ledgerEntryResultSchema
  }, ({ id, ...patch }) => invoke(editing, () => useCases.updateEntry(id, patch)));

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
