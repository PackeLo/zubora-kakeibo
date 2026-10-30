// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@modelcontextprotocol/client";
import { z } from "zod";
import { oauthFixture } from "../helpers/oauth";
import { supportedScopes } from "@back/adapters/auth/scopes";

afterEach(() => vi.restoreAllMocks());

async function data(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
  expect(result.structuredContent).toBeDefined();
  return z.record(z.string(), z.unknown()).parse(result.structuredContent);
}

describe("household MCP tools", () => {
  it("retrieves, edits and confirms a high-confidence draft through MCP and returns the same posted result on retry", async () => {
    const fixture = await oauthFixture();
    const { tokens } = await fixture.login(supportedScopes);
    const client = await fixture.connect(tokens.access_token);
    try {
      const category = await data(client, "createCategory", { code: "mcp-draft", name: "食費", kind: "expense" });
      const tag = await data(client, "createTag", { name: "スーパー" });
      const day = new Date().toISOString().slice(0, 10);
      const imported = await data(client, "createEntrySource", { sourceType: "receipt", items: [{ entryType: "expense", entryDate: day, amount: 321, categoryNameGuess: "食費", confidence: 0.96 }] });
      const id = (imported.createdEntrySourceItemIds as string[])[0];
      expect(await data(client, "listEntrySourceItems", { entrySourceId: imported.entrySourceId })).toMatchObject({ items: [{ id, categoryIdGuess: category.id, status: "pending" }] });
      expect(await data(client, "getEntrySourceItem", { id })).toMatchObject({ tags: [], confidence: 0.96 });
      expect(await data(client, "updateEntrySourceItem", { id, tags: ["スーパー"], subjectUserId: "usr_access_admin@example.test" })).toMatchObject({ tags: ["スーパー"], amount: 321, status: "pending" });
      expect(await data(client, "getInsightOverview", { from: day, to: day })).toMatchObject({ expenseTotal: 0 });
      expect((await client.callTool({ name: "updateEntrySourceItem", arguments: { id, confidence: 1 } })).isError).toBe(true);
      const posted = await data(client, "postEntrySourceItem", { id });
      expect(await data(client, "postEntrySourceItem", { id })).toEqual(posted);
      expect(await data(client, "getEntrySourceItem", { id })).toMatchObject({ status: "posted", postedEntryId: posted.id });
      expect(await data(client, "listEntrySourceItems")).toEqual({ items: [] });
      expect(await data(client, "getInsightOverview", { from: day, to: day })).toMatchObject({ expenseTotal: 321 });
      expect(await data(client, "getCategoryInsights", { from: day, to: day, tagIds: [tag.id] })).toMatchObject({ items: [{ amount: 321 }] });
      expect((await client.callTool({ name: "updateEntrySourceItem", arguments: { id, memo: "変更不可" } })).isError).toBe(true);
      const ledger = await data(client, "getEntry", { id: posted.id });
      expect(ledger).toMatchObject({ amount: 321, tags: [{ id: tag.id }], revision: posted.revision });
      const edited = await data(client, "updateEntry", { id: posted.id, expectedRevision: ledger.revision, amount: 345, tagIds: [], target: "修正" });
      expect(edited).toMatchObject({ id: posted.id, amount: 345, target: "修正", tags: [] });
      expect(edited.revision).not.toBe(ledger.revision);
      expect(await data(client, "getEntry", { id: posted.id })).toEqual(edited);
      expect((await client.callTool({ name: "updateEntry", arguments: { id: posted.id, expectedRevision: ledger.revision, amount: 999 } })).isError).toBe(true);
      expect(await data(client, "getInsightOverview", { from: day, to: day })).toMatchObject({ expenseTotal: 345 });
      expect(await data(client, "getEntrySourceItem", { id })).toMatchObject({ amount: 321, status: "posted" });
    } finally { await client.close(); }
  });

  it("does not grant draft editing or posting to a read/import-only connection", async () => {
    const fixture = await oauthFixture();
    const { tokens } = await fixture.login(["kakeibo:read", "kakeibo:import"]);
    const client = await fixture.connect(tokens.access_token);
    try {
      const source = await data(client, "createEntrySource", { sourceType: "receipt", items: [{ entryType: "income", confidence: 1 }] });
      const id = (source.createdEntrySourceItemIds as string[])[0];
      await expect(client.callTool({ name: "updateEntrySourceItem", arguments: { id, memo: "拒否" } })).rejects.toThrow();
      await expect(client.callTool({ name: "postEntrySourceItem", arguments: { id } })).rejects.toThrow();
      await expect(client.callTool({ name: "updateEntry", arguments: { id: "unknown", expectedRevision: "unknown", amount: 100 } })).rejects.toThrow();
      expect(await data(client, "getEntrySourceItem", { id })).toMatchObject({ memo: null, status: "pending" });
    } finally { await client.close(); }
  });

  it("manages categories, tags, and assets through the authenticated MCP client while preserving omitted fields", async () => {
    const fixture = await oauthFixture();
    const { tokens } = await fixture.login(supportedScopes);
    const client = await fixture.connect(tokens.access_token);
    try {
      const tools = (await client.listTools()).tools;
      expect(tools).toHaveLength(23);
      expect(tools.find((tool) => tool.name === "deleteCategory")?.annotations?.destructiveHint).toBe(true);
      expect(tools.find((tool) => tool.name === "getTaxonomy")?.annotations?.readOnlyHint).toBe(true);
      const category = await data(client, "createCategory", { code: "food", name: "食費", kind: "expense", isActive: false, dedupeEnabled: false, sortOrder: 7 });
      const categoryId = String(category.id);
      const edited = await data(client, "updateCategory", { id: categoryId, name: "家族の食費" });
      expect(edited).toMatchObject({ name: "家族の食費", isActive: false, dedupeEnabled: false, sortOrder: 7 });
      await data(client, "updateCategory", { id: categoryId, isActive: true });
      const tag = await data(client, "createTag", { name: "変更前", isActive: false });
      const tagId = String(tag.id);
      expect(await data(client, "updateTag", { id: tagId, name: "動作確認" })).toMatchObject({ name: "動作確認", isActive: false });
      await data(client, "updateTag", { id: tagId, isActive: true });
      const asset = await data(client, "createFinancialAsset", { name: "海外預金", assetType: "bank_deposit", currency: "USD", valuationMinor: 12345, quantityText: "123.45 USD" });
      expect(await data(client, "updateFinancialAsset", { id: asset.id, name: "変更後預金" })).toMatchObject({ name: "変更後預金", currency: "USD", valuationMinor: 12345, quantityText: "123.45 USD" });
      expect(await data(client, "deleteFinancialAsset", { id: asset.id })).toMatchObject({ isActive: false });
      expect(await data(client, "listFinancialAssets")).toEqual({ items: [] });
      expect(await data(client, "listFinancialAssets", { includeInactive: true })).toMatchObject({ items: [{ id: asset.id, isActive: false }] });
      const users = await data(client, "listUsers");
      expect(JSON.stringify(users)).not.toContain("passwordHash");
      const day = new Date().toISOString().slice(0, 10);
      const sourceInput = { sourceType: "receipt", idempotencyKey: "mcp-receipt-test", items: [{ entryType: "expense", entryDate: day, amount: 100, categoryCodeGuess: "food", tags: ["動作確認"] }] };
      const imported = await data(client, "createEntrySource", sourceInput);
      expect(await data(client, "createEntrySource", sourceInput)).toEqual(imported);
      expect(await data(client, "getInsightOverview", { from: day, to: day })).toMatchObject({ expenseTotal: 0 });
      expect(await data(client, "getMonthlyInsights", { from: day, to: day })).toHaveProperty("months");
      expect(await data(client, "getCategoryInsights", { from: day, to: day })).toEqual({ items: [] });
      expect(await data(client, "getInsightEntries", { from: day, to: day, limit: 10 })).toEqual({ items: [] });
      const itemIds = imported.createdEntrySourceItemIds as string[];
      const headers = { ...await fixture.access.headers({ email: "admin@example.test", sub: "admin@example.test" }), "Content-Type": "application/json" };
      expect((await fixture.request(`/api/entry-source-items/${itemIds[0]}`, { method: "PATCH", headers, body: JSON.stringify({ amount: 120 }) })).status).toBe(200);
      const posted = await fixture.request(`/api/entry-source-items/${itemIds[0]}/post`, { method: "POST", headers, body: JSON.stringify({ entryType: "expense", entryDate: day, amount: 120, currency: "JPY", subjectUserId: "usr_access_admin@example.test", categoryId, tagIds: [tagId] }) });
      expect(posted.status).toBe(200);
      expect(await data(client, "getCategoryInsights", { from: day, to: day, tagIds: [tagId] })).toMatchObject({ items: [{ amount: 120, categoryId }] });
      expect(await data(client, "deleteCategory", { id: categoryId })).toMatchObject({ mode: "deactivated" });
      expect(await data(client, "deleteTag", { id: tagId })).toMatchObject({ mode: "deactivated" });
      const unused = await data(client, "createCategory", { code: "unused", name: "未使用", kind: "income" });
      expect(await data(client, "deleteCategory", { id: unused.id })).toMatchObject({ mode: "deleted" });
      const unusedTag = await data(client, "createTag", { name: "未使用" });
      expect(await data(client, "deleteTag", { id: unusedTag.id })).toMatchObject({ mode: "deleted" });
    } finally { await client.close(); }
  });

  it("enforces scopes and rechecks membership and admin status for existing OAuth links", async () => {
    const fixture = await oauthFixture();
    const read = await fixture.login();
    const reader = await fixture.connect(read.tokens.access_token);
    try {
      await expect(reader.callTool({ name: "createFinancialAsset", arguments: { name: "forbidden", assetType: "cash" } })).rejects.toThrow();
      expect(await fixture.repositories.financialAssets.list(true)).toEqual([]);
    } finally { await reader.close(); }
    const all = await fixture.login(supportedScopes);
    const admin = await fixture.connect(all.tokens.access_token);
    try {
      fixture.env.ADMIN_EMAILS = "other@example.test";
      const forbidden = await admin.callTool({ name: "createCategory", arguments: { code: "forbidden", name: "拒否", kind: "expense" } });
      expect(forbidden.isError).toBe(true);
      expect(await fixture.repositories.taxonomy.listCategories(true)).toEqual([]);
      fixture.env.HOUSEHOLD_EMAILS = "";
      await expect(admin.listTools()).rejects.toThrow();
    } finally { await admin.close(); }
  });

  it("rejects invalid dates and limits through the MCP protocol", async () => {
    const fixture = await oauthFixture();
    const { tokens } = await fixture.login();
    const client = await fixture.connect(tokens.access_token);
    try {
      for (const args of [{ from: "2026-02-31", to: "2026-03-01", limit: 1 }, { from: "2026-10-23", to: "2026-10-01", limit: 1 }, { from: "2020-01-01", to: "2026-10-23", limit: 1 }, { from: "2026-10-01", to: "2026-10-23", limit: 201 }]) {
        const result = await client.callTool({ name: "getInsightEntries", arguments: args });
        expect(result.isError).toBe(true);
      }
    } finally { await client.close(); }
  });
});
