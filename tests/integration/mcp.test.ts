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

  it.each([0.5, 0.95, null])("explicitly confirms a verified draft with confidence %s without changing its confidence", async (confidence) => {
    const fixture = await oauthFixture();
    const { tokens } = await fixture.login(supportedScopes);
    const client = await fixture.connect(tokens.access_token);
    try {
      const category = await data(client, "createCategory", { code: "verified", name: "食費", kind: "expense" });
      const tag = await data(client, "createTag", { name: "確認済み" });
      const day = new Date().toISOString().slice(0, 10);
      const imported = await data(client, "createEntrySource", { sourceType: "receipt", items: [{ entryType: "expense", entryDate: day, amount: 100, confidence }] });
      const id = (imported.createdEntrySourceItemIds as string[])[0];
      expect((await client.callTool({ name: "postEntrySourceItem", arguments: { id } })).isError).toBe(true);
      const input = { id, entryType: "expense", entryDate: day, amount: 456, currency: "JPY", subjectUserId: "usr_access_admin@example.test", categoryId: category.id, tagIds: [tag.id], target: "確認した品目", memo: "証跡で確認" };
      expect((await client.callTool({ name: "confirmEntrySourceItem", arguments: { ...input, confidence: 1 } })).isError).toBe(true);
      for (const key of Object.keys(input).filter((key) => key !== "id")) {
        const incomplete: Record<string, unknown> = { ...input };
        delete incomplete[key];
        expect((await client.callTool({ name: "confirmEntrySourceItem", arguments: incomplete })).isError).toBe(true);
      }
      expect((await client.callTool({ name: "confirmEntrySourceItem", arguments: { ...input, categoryId: null } })).isError).toBe(true);
      expect(await data(client, "getEntrySourceItem", { id })).toMatchObject({ status: "pending", amount: 100, confidence });
      const posted = await data(client, "confirmEntrySourceItem", input);
      expect(posted).toMatchObject({ entryType: "expense", entryDate: day, amount: 456, currency: "JPY", subjectUserId: input.subjectUserId, categoryId: category.id, tags: [{ id: tag.id }], target: input.target, memo: input.memo });
      expect(await data(client, "getEntrySourceItem", { id })).toMatchObject({ status: "posted", amount: 456, confidence, postedEntryId: posted.id });
      expect(await data(client, "getInsightOverview", { from: day, to: day })).toMatchObject({ expenseTotal: 456 });
      expect((await client.callTool({ name: "confirmEntrySourceItem", arguments: input })).isError).toBe(true);
      expect(await data(client, "getInsightEntries", { from: day, to: day, limit: 10 })).toMatchObject({ items: [{ id: posted.id }] });
    } finally { await client.close(); }
  });

  it("deletes pending drafts with drafts scope and cleans up the source only after its last item", async () => {
    const fixture = await oauthFixture();
    const { tokens } = await fixture.login(["kakeibo:read", "kakeibo:import", "kakeibo:drafts:write"]);
    const client = await fixture.connect(tokens.access_token);
    try {
      const imported = await data(client, "createEntrySource", { sourceType: "receipt", items: [{ entryType: "expense" }, { entryType: "expense" }] });
      const [first, last] = imported.createdEntrySourceItemIds as string[];
      await fixture.repositories.duplicates.createExclusion({ id: "exclusion", entrySourceItemId: first, entryId: "entry", pairKey: "pair", reason: null, createdBy: "test", createdAt: new Date().toISOString() });
      expect(await data(client, "deleteEntrySourceItem", { id: first })).toEqual({ deletedSource: false });
      expect(await fixture.repositories.entrySourceItems.findById(first)).toBeNull();
      expect(await fixture.repositories.duplicates.findExclusion("pair")).toBeNull();
      expect(await data(client, "listEntrySourceItems", { entrySourceId: imported.entrySourceId })).toMatchObject({ items: [{ id: last }] });
      expect(await data(client, "deleteEntrySourceItem", { id: last })).toEqual({ deletedSource: true });
      expect(await fixture.repositories.entrySources.findById(String(imported.entrySourceId))).toBeNull();
      expect((await client.callTool({ name: "deleteEntrySourceItem", arguments: { id: last } })).isError).toBe(true);
    } finally { await client.close(); }
  });

  it("rejects deletion of a posted source item and preserves the ledger and source", async () => {
    const fixture = await oauthFixture();
    const { tokens } = await fixture.login(supportedScopes);
    const client = await fixture.connect(tokens.access_token);
    try {
      const day = new Date().toISOString().slice(0, 10);
      const imported = await data(client, "createEntrySource", { sourceType: "receipt", items: [{ entryType: "income", entryDate: day, amount: 789, subjectUserId: "usr_access_admin@example.test", confidence: 0.99 }] });
      const id = (imported.createdEntrySourceItemIds as string[])[0];
      const posted = await data(client, "postEntrySourceItem", { id });
      const result = await client.callTool({ name: "deleteEntrySourceItem", arguments: { id } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("CONFLICT");
      expect(await data(client, "getEntrySourceItem", { id })).toMatchObject({ status: "posted", postedEntryId: posted.id });
      expect(await data(client, "getEntry", { id: posted.id })).toMatchObject({ amount: 789 });
      expect(await fixture.repositories.entrySources.findById(String(imported.entrySourceId))).not.toBeNull();
      expect(await data(client, "getInsightOverview", { from: day, to: day })).toMatchObject({ incomeTotal: 789 });
    } finally { await client.close(); }
  });

  it("rejects draft deletion when the draft is posted after the initial read", async () => {
    const fixture = await oauthFixture();
    const { tokens } = await fixture.login(supportedScopes);
    const client = await fixture.connect(tokens.access_token);
    try {
      const imported = await data(client, "createEntrySource", { sourceType: "receipt", items: [{ entryType: "income" }] });
      const id = (imported.createdEntrySourceItemIds as string[])[0];
      const originalDelete = fixture.repositories.entrySourceItems.deletePending.bind(fixture.repositories.entrySourceItems);
      vi.spyOn(fixture.repositories.entrySourceItems, "deletePending").mockImplementationOnce(async (itemId, updatedAt) => {
        await fixture.repositories.entrySourceItems.update(itemId, { status: "posted" });
        return originalDelete(itemId, updatedAt);
      });
      const cleanup = vi.spyOn(fixture.repositories.duplicates, "deleteByEntrySourceItemId");
      const result = await client.callTool({ name: "deleteEntrySourceItem", arguments: { id } });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("CONFLICT");
      expect(cleanup).not.toHaveBeenCalled();
      expect(await data(client, "getEntrySourceItem", { id })).toMatchObject({ status: "posted" });
      expect(await fixture.repositories.entrySources.findById(String(imported.entrySourceId))).not.toBeNull();
    } finally { await client.close(); }
  });

  it.each([{ extraScopes: [] }, { extraScopes: ["kakeibo:drafts:write"] }, { extraScopes: ["kakeibo:entries:post"] }])("enforces confirmation and deletion scope boundaries with extra scopes $extraScopes", async ({ extraScopes }) => {
    const fixture = await oauthFixture();
    const { tokens } = await fixture.login(["kakeibo:read", "kakeibo:import", ...extraScopes]);
    const client = await fixture.connect(tokens.access_token);
    try {
      const source = await data(client, "createEntrySource", { sourceType: "receipt", items: [{ entryType: "income", confidence: 1 }] });
      const id = (source.createdEntrySourceItemIds as string[])[0];
      if (!extraScopes.includes("kakeibo:drafts:write")) {
        await expect(client.callTool({ name: "updateEntrySourceItem", arguments: { id, memo: "拒否" } })).rejects.toThrow();
        await expect(client.callTool({ name: "deleteEntrySourceItem", arguments: { id } })).rejects.toThrow();
      }
      if (!extraScopes.includes("kakeibo:entries:post")) {
        await expect(client.callTool({ name: "postEntrySourceItem", arguments: { id } })).rejects.toThrow();
        await expect(client.callTool({ name: "confirmEntrySourceItem", arguments: { id, entryType: "income", entryDate: new Date().toISOString().slice(0, 10), amount: 100, currency: "JPY", subjectUserId: "usr_access_admin@example.test", categoryId: null, tagIds: [], target: null, memo: null } })).rejects.toThrow();
      }
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
      expect(tools).toHaveLength(25);
      expect(tools.find((tool) => tool.name === "deleteEntrySourceItem")?.annotations?.destructiveHint).toBe(true);
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
      const receipts = await fixture.request(`/api/receipts?from=${day}&to=${day}`, { headers });
      expect(receipts.status).toBe(200);
      expect(await receipts.json()).toMatchObject({ totalItems: 1, items: [{ entryCount: 1, totals: [{ currency: "JPY", amount: 120 }] }] });
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
