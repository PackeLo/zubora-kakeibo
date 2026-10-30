// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "@back/adapters/http/app";
import { InMemoryUnitOfWork } from "@back/adapters/memory/InMemoryRepositories";
import type { Env } from "@back/worker/bindings";
import { accessFixture } from "../helpers/access";

afterEach(() => vi.restoreAllMocks());

function createTestApp() {
  const repos = new InMemoryUnitOfWork();
  const app = createApiApp(() => repos);
  const env: Env = {
    DB: {} as D1Database,
    GPT_ACTION_TOKEN: "token",
    ALLOW_DEV_AUTH: "false",
    LIVE_COMPLETED_YEARS_TO_KEEP: "3"
  };
  return { app, env, repos };
}

describe("routes", () => {
  it("does not store malformed pending tag references", async () => {
    const { app, env } = createTestApp();
    const fixture = await accessFixture();
    const response = await app.request("https://app.example.test/api/entry-source-items/missing", {
      method: "PATCH", headers: { ...await fixture.headers(), "Content-Type": "application/json" }, body: JSON.stringify({ tagsJson: "not json" })
    }, { ...env, ...fixture.env });
    expect(response.status).toBe(400);
  });
  it("keeps Actions tokens and web credentials separate", async () => {
    const { app, env } = createTestApp();
    const fixture = await accessFixture();
    const webEnv = { ...env, ...fixture.env };
    const webResponse = await app.request("https://app.example.test/api/entries", { headers: { Authorization: "Bearer token" } }, webEnv);
    expect(webResponse.status).toBe(401);
    const actionResponse = await app.request("https://app.example.test/api/action/taxonomy", { headers: await fixture.headers() }, webEnv);
    expect(actionResponse.status).toBe(401);
    const wrongToken = await app.request("https://app.example.test/api/action/taxonomy", { headers: { Authorization: "Bearer wrong" } }, webEnv);
    expect(wrongToken.status).toBe(401);
  });

  it("imports a receipt, saves corrections, posts tags, and includes only confirmed amounts in summaries", async () => {
    const { app, env, repos } = createTestApp();
    const fixture = await accessFixture();
    const webEnv = { ...env, ...fixture.env };
    const headers = { ...await fixture.headers(), "Content-Type": "application/json" };
    const day = new Date().toISOString().slice(0, 10);
    const categoryResponse = await app.request("https://app.example.test/api/categories", {
      method: "POST", headers, body: JSON.stringify({ code: "food", name: "食費", kind: "expense" })
    }, webEnv);
    expect(categoryResponse.status).toBe(201);
    const category = await categoryResponse.json() as { id: string };
    const tagResponse = await app.request("https://app.example.test/api/tags", {
      method: "POST", headers, body: JSON.stringify({ name: "家族" })
    }, webEnv);
    expect(tagResponse.status).toBe(201);
    const tag = await tagResponse.json() as { id: string };
    const actionRequest = {
      method: "POST",
      headers: { Authorization: "Bearer token", "Content-Type": "application/json", "Idempotency-Key": "receipt-test" },
      body: JSON.stringify({ sourceType: "receipt", items: [{ entryType: "expense", entryDate: day, amount: 1000, tags: ["家族"], categoryNameGuess: "日用品" }] })
    };
    const imported = await app.request("https://app.example.test/api/action/entry-sources", actionRequest, webEnv);
    expect(imported.status).toBe(200);
    const receipt = await imported.json() as { createdEntrySourceItemIds: string[] };
    const repeated = await app.request("https://app.example.test/api/action/entry-sources", actionRequest, webEnv);
    expect(await repeated.json()).toMatchObject(receipt);
    const itemId = receipt.createdEntrySourceItemIds[0];
    const summaryUrl = `https://app.example.test/api/action/insights/category?from=${day}&to=${day}&type=expense`;
    const actionHeaders = { Authorization: "Bearer token" };
    const before = await app.request(summaryUrl, { headers: actionHeaders }, webEnv);
    expect(await before.json()).toEqual([]);
    const saved = await app.request(`https://app.example.test/api/entry-source-items/${itemId}`, {
      method: "PATCH", headers, body: JSON.stringify({ amount: 1200, categoryIdGuess: category.id, categoryNameGuess: "食費", tagsJson: JSON.stringify(["家族"]) })
    }, webEnv);
    expect(saved.status).toBe(200);
    const postRequest = {
      method: "POST", headers,
      body: JSON.stringify({ entryType: "expense", entryDate: day, amount: 1200, currency: "JPY", subjectUserId: "usr_access_test-user", categoryId: category.id, tagIds: [tag.id] })
    };
    const posted = await app.request(`https://app.example.test/api/entry-source-items/${itemId}/post`, postRequest, webEnv);
    expect(posted.status).toBe(200);
    expect(await posted.json()).toMatchObject({ amount: 1200, categoryId: category.id, tags: [{ id: tag.id, name: "家族" }] });
    const duplicatePost = await app.request(`https://app.example.test/api/entry-source-items/${itemId}/post`, postRequest, webEnv);
    expect(duplicatePost.status).toBe(409);
    const after = await app.request(summaryUrl, { headers: actionHeaders }, webEnv);
    expect(await after.json()).toMatchObject([{ categoryId: category.id, categoryName: "食費", amount: 1200, entryCount: 1 }]);
    const all = await repos.entries.list({});
    const ledger = all[0];
    const detailUrl = `https://app.example.test/api/entries/${ledger.id}`;
    expect(await (await app.request(detailUrl, { headers }, webEnv)).json()).toMatchObject({ revision: ledger.revision });
    const edited = await app.request(detailUrl, { method: "PATCH", headers, body: JSON.stringify({ expectedRevision: ledger.revision, amount: 1500, tagIds: [] }) }, webEnv);
    expect(edited.status).toBe(200);
    expect(await edited.json()).toMatchObject({ id: ledger.id, amount: 1500, tags: [] });
    const conflict = await app.request(detailUrl, { method: "PATCH", headers, body: JSON.stringify({ expectedRevision: ledger.revision, amount: 9999 }) }, webEnv);
    expect(conflict.status).toBe(409);
    expect(await (await app.request(summaryUrl, { headers: actionHeaders }, webEnv)).json()).toMatchObject([{ amount: 1500, entryCount: 1 }]);
    expect(await repos.entries.list({})).toHaveLength(1);
  });

  it("creates, filters, paginates, renames, and ungroups receipts", async () => {
    const { app, env } = createTestApp();
    const fixture = await accessFixture();
    const webEnv = { ...env, ...fixture.env };
    const headers = { ...await fixture.headers(), "Content-Type": "application/json" };
    const categoryResponse = await app.request("https://app.example.test/api/categories", {
      method: "POST", headers, body: JSON.stringify({ code: "bakery", name: "パン", kind: "expense" })
    }, webEnv);
    const category = await categoryResponse.json() as { id: string };
    const entryIds: string[] = [];
    for (const [target, amount] of [["食パン", 300], ["菓子パン", 200]] as const) {
      const response = await app.request("https://app.example.test/api/entries", {
        method: "POST",
        headers,
        body: JSON.stringify({
          entryType: "expense",
          entryDate: "2026-10-28",
          amount,
          subjectUserId: "usr_access_test-user",
          categoryId: category.id,
          tagIds: [],
          target
        })
      }, webEnv);
      expect(response.status).toBe(201);
      entryIds.push(((await response.json()) as { id: string }).id);
    }
    const created = await app.request("https://app.example.test/api/receipts", {
      method: "POST", headers, body: JSON.stringify({ entryIds, displayName: "パン屋" })
    }, webEnv);
    expect(created.status).toBe(201);
    const receipt = await created.json() as { id: string };

    const listed = await app.request(`https://app.example.test/api/receipts?categoryIds=${category.id}&page=1&pageSize=1`, { headers }, webEnv);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({
      page: 1,
      pageSize: 1,
      totalItems: 1,
      totalPages: 1,
      filteredReceiptTotals: [{ currency: "JPY", amount: 500 }],
      items: [{ id: receipt.id, displayName: "パン屋", entryCount: 2 }]
    });
    expect((await app.request(`https://app.example.test/api/receipts/${receipt.id}`, {
      method: "PATCH", headers, body: JSON.stringify({ displayName: "駅前パン屋" })
    }, webEnv)).status).toBe(200);
    expect((await app.request(`https://app.example.test/api/receipts/${receipt.id}`, { method: "DELETE", headers }, webEnv)).status).toBe(200);
    const entries = await app.request("https://app.example.test/api/entries?from=2026-10-28&to=2026-10-28", { headers }, webEnv);
    expect(await entries.json()).toMatchObject({ items: [{ receiptId: null }, { receiptId: null }] });
  });

  it("validates receipt paging and duplicate member IDs at the HTTP boundary", async () => {
    const { app, env } = createTestApp();
    const fixture = await accessFixture();
    const webEnv = { ...env, ...fixture.env };
    const headers = { ...await fixture.headers(), "Content-Type": "application/json" };
    expect((await app.request("https://app.example.test/api/receipts?page=0", { headers }, webEnv)).status).toBe(400);
    expect((await app.request("https://app.example.test/api/receipts?page=abc", { headers }, webEnv)).status).toBe(400);
    const duplicate = await app.request("https://app.example.test/api/receipts", {
      method: "POST", headers, body: JSON.stringify({ entryIds: ["ent_same", "ent_same"] })
    }, webEnv);
    expect(duplicate.status).toBe(400);
  });

  it("requires web authentication for normal API on production hosts", async () => {
    const { app, env } = createTestApp();
    const response = await app.request("https://app.example.test/api/taxonomy", {}, env);
    expect(response.status).toBe(401);
  });

  it("rejects action calls without token", async () => {
    const { app, env } = createTestApp();
    const response = await app.request("/api/action/taxonomy", {}, env);
    expect(response.status).toBe(401);
  });

  it("creates action entry source with token", async () => {
    const { app, env } = createTestApp();
    const response = await app.request(
      "/api/action/entry-sources",
      {
        method: "POST",
        headers: { Authorization: "Bearer token", "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceType: "receipt",
          items: [{ entryType: "expense", entryDate: "2026-06-20", amount: 1000 }]
        })
      },
      env
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { createdEntrySourceItemIds: string[] };
    expect(payload.createdEntrySourceItemIds).toHaveLength(1);
  });

  it("requires limit for action entries insight", async () => {
    const { app, env } = createTestApp();
    const response = await app.request(
      "/api/action/insights/entries?from=2026-06-01&to=2026-06-30",
      { headers: { Authorization: "Bearer token" } },
      env
    );
    expect(response.status).toBe(400);
  });

  it("limits action entry insight date ranges", async () => {
    const { app, env } = createTestApp();
    const response = await app.request(
      "/api/action/insights/entries?from=2024-01-01&to=2026-01-31&limit=10",
      { headers: { Authorization: "Bearer token" } },
      env
    );
    expect(response.status).toBe(400);
  });

  it("maps domain validation errors to bad request", async () => {
    const { app, env } = createTestApp();
    const fixture = await accessFixture();
    const response = await app.request(
      "https://app.example.test/api/entries",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...await fixture.headers()
        },
        body: JSON.stringify({
          entryType: "expense",
          entryDate: "2026-02-31",
          amount: 1000,
          subjectUserId: "usr_user_example_test",
          categoryId: "cat_missing",
          tagIds: []
        })
      },
      { ...env, ...fixture.env }
    );
    expect(response.status).toBe(400);
  });
});
