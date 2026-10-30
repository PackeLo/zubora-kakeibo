// @vitest-environment node
import { describe, expect, it } from "vitest";
import { oauthFixture } from "../helpers/oauth";
import { KakeiboUseCases } from "@back/application/useCases";
import type { EntryFilters } from "@back/domain/types";

async function fixture() {
  const api = await oauthFixture();
  const { tokens, flow } = await api.login();
  const app = new KakeiboUseCases(api.repositories, { liveCompletedYearsToKeep: 3 });
  const actor = { id: "usr_access_admin@example.test", displayName: "admin@example.test", role: "admin" as const };
  const advance = await app.createCategory({ code: "advance", name: "立替金", kind: "expense" }, actor);
  const food = await app.createCategory({ code: "food", name: "食費", kind: "expense" }, actor);
  const leisure = await app.createCategory({ code: "leisure", name: "娯楽", kind: "expense" }, actor);
  const refund = await app.createTag({ name: "精算対象" });
  const common = await app.createTag({ name: "共通" });
  const special = await app.createTag({ name: "臨時" });
  const date = `${new Date().toISOString().slice(0, 4)}-10-10`;
  const base = { entryType: "expense" as const, entryDate: date, subjectUserId: actor.id };
  const entries = {
    advance: await app.createManualEntry({ ...base, categoryId: advance.id, amount: 5000, tagIds: [refund.id, common.id] }, actor),
    food: await app.createManualEntry({ ...base, categoryId: food.id, amount: 3000, tagIds: [common.id] }, actor),
    leisure: await app.createManualEntry({ ...base, categoryId: leisure.id, amount: 2000 }, actor),
    special: await app.createManualEntry({ ...base, categoryId: food.id, amount: 400, tagIds: [special.id] }, actor),
    income: await app.createManualEntry({ ...base, entryType: "income", amount: 1000 }, actor)
  };
  await app.updateCategory(leisure.id, { isActive: false }, actor);
  const range = { from: date.slice(0, 8) + "01", to: date.slice(0, 8) + "31" };
  const client = await api.connect(tokens.access_token);
  return { api, client, app, actor, range, entries, advance, food, leisure, refund, common, special, headers: flow.headers };
}

describe("category and tag exclusion filters", () => {
  it("uses identical filtered entries and amounts through HTTP and all four MCP insights", async () => {
    const f = await fixture();
    const cases: Array<{ filters: EntryFilters; keys: Array<keyof typeof f.entries> }> = [
      { filters: {}, keys: ["advance", "food", "leisure", "special"] },
      { filters: { excludedCategoryIds: [f.advance.id] }, keys: ["food", "leisure", "special"] },
      { filters: { excludedTagIds: [f.refund.id, f.special.id] }, keys: ["food", "leisure"] },
      { filters: { excludedCategoryIds: [f.advance.id], excludedTagIds: [f.special.id] }, keys: ["food", "leisure"] },
      { filters: { categoryIds: [f.food.id, f.leisure.id], excludedCategoryIds: [f.advance.id], excludedTagIds: [f.special.id] }, keys: ["food", "leisure"] },
      { filters: { tagIds: [f.common.id], excludedCategoryIds: [f.advance.id] }, keys: ["food"] },
      { filters: { excludedTagIds: [f.common.id] }, keys: ["leisure", "special"] },
      { filters: { categoryIds: [f.food.id], excludedCategoryIds: [f.food.id] }, keys: [] },
      { filters: { tagIds: [f.common.id], excludedTagIds: [f.common.id] }, keys: [] },
      { filters: { excludedCategoryIds: [f.advance.id, f.food.id, f.leisure.id] }, keys: [] },
      { filters: { excludedCategoryIds: [], excludedTagIds: [], subjectUserIds: [f.actor.id], registeredByEmails: [f.actor.displayName] }, keys: ["advance", "food", "leisure", "special"] }
    ];
    try {
      for (const { filters, keys } of cases) {
        const args = { ...f.range, type: "expense", ...filters };
        const total = keys.reduce((sum, key) => sum + f.entries[key].amount, 0);
        const ids = keys.map(key => f.entries[key].id).sort();
        const query = new URLSearchParams(Object.entries(args).map(([key, value]) => [key, Array.isArray(value) ? value.join(",") : String(value)]));
        async function get(path: string) {
          const response = await f.api.request(`${path}?${query}`, { headers: f.headers });
          expect(response.status).toBe(200);
          return response.json() as Promise<Record<string, Array<Record<string, number | string>>>>;
        }
        const httpEntries = (await get("/api/entries")).items;
        expect(httpEntries.map(entry => entry.id).sort()).toEqual(ids);
        for (const [path, key, amount] of [["daily", "days", "expenseTotal"], ["monthly", "months", "expenseTotal"], ["category", "items", "amount"]]) {
          const result = await get(`/api/summaries/${path}`);
          expect(result[key].reduce((sum, row) => sum + Number(row[amount]), 0)).toBe(total);
        }
        for (const name of ["getInsightEntries", "getInsightOverview", "getMonthlyInsights", "getCategoryInsights"]) {
          const response = await f.client.callTool({ name, arguments: { ...args, ...(name === "getInsightEntries" ? { limit: 200 } : {}) } });
          expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
          const result = response.structuredContent as { items: Array<{ id: string; amount: number }>; months: Array<{ expenseTotal: number }>; expenseTotal: number };
          if (name === "getInsightEntries") expect(result.items.map(entry => entry.id).sort()).toEqual(ids);
          if (name === "getInsightOverview") expect(result.expenseTotal).toBe(total);
          if (name === "getMonthlyInsights") expect(result.months.reduce((sum, month) => sum + month.expenseTotal, 0)).toBe(total);
          if (name === "getCategoryInsights") expect(result.items.reduce((sum, category) => sum + category.amount, 0)).toBe(total);
        }
      }
      expect(await f.app.listEntries(f.range)).toHaveLength(5);
    } finally { await f.client.close(); }
  });

  it("retains uncategorized and untagged entries and combines exclusions with dates and people", async () => {
    const f = await fixture();
    try {
      const excludedCategoryIds = [f.advance.id, f.food.id, f.leisure.id];
      const filters = { ...f.range, excludedCategoryIds, excludedTagIds: [f.refund.id, f.common.id, f.special.id] };
      expect(await f.app.listEntries(filters)).toMatchObject([{ id: f.entries.income.id, categoryId: null, tags: [] }]);
      expect(await f.app.householdOverview(filters)).toMatchObject({ expenseTotal: 0, incomeTotal: 1000 });
      expect(await f.app.listEntries({ ...filters, registeredByEmails: ["other@example.test"] })).toEqual([]);
      expect(await f.app.listEntries({ ...filters, subjectUserIds: ["other"] })).toEqual([]);
      expect(await f.app.listEntries({ ...filters, from: f.range.to })).toEqual([]);
      const response = await f.client.callTool({ name: "getInsightEntries", arguments: { ...filters, limit: 200 } });
      expect(response.isError).not.toBe(true);
      expect(response.structuredContent).toMatchObject({ items: [{ id: f.entries.income.id }] });
      expect((await f.client.callTool({ name: "getCategoryInsights", arguments: { ...f.range, excludedTagIds: [""] } })).isError).toBe(true);
    } finally { await f.client.close(); }
  });
});
