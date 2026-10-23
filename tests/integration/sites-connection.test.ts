// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import connection, { sitesBearer, type ConnectionEnv } from "../../app/connection/worker";
import { oauthFixture } from "../helpers/oauth";

afterEach(() => vi.restoreAllMocks());

async function fixture() {
  const household = await oauthFixture();
  const pair = await generateKeyPair("ES256", { extractable: true });
  const issuer = "https://household.workspace.chatgpt.site";
  const kid = "test-site-key";
  household.env.SITES_TOKEN_ISSUER = issuer;
  household.env.SITES_TOKEN_PUBLIC_JWK = JSON.stringify({ ...await exportJWK(pair.publicKey), kid });
  const env: ConnectionEnv = {
    KAKEIBO_SITE_ORIGIN: issuer, KAKEIBO_MCP_URL: `${household.origin}/mcp`,
    KAKEIBO_SIGNING_PRIVATE_JWK: JSON.stringify({ ...await exportJWK(pair.privateKey), kid })
  };
  await household.repositories.users.upsertAccessUser({ id: "usr_existing_admin", displayName: "admin@example.test", role: "member" });
  const originalFetch = household.access.fetchMock.getMockImplementation()!;
  household.access.fetchMock.mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    if (request.url.startsWith(`${household.origin}/mcp`)) {
      return household.request("/mcp", { method: request.method, headers: request.headers, body: request.method === "POST" ? await request.text() : undefined });
    }
    return originalFetch(input, init);
  });
  async function call(method: string, params = {}, email: string | null = "admin@example.test") {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (email) Object.assign(headers, { "oai-authenticated-user-id": "sites-scoped-user", "oai-authenticated-user-email": email });
    const response = await connection.fetch(new Request(`${issuer}/mcp`, { method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), env);
    return await response.json() as { result?: { isError?: boolean; structuredContent?: Record<string, unknown>; tools?: { name: string }[]; content?: unknown[] }; error?: { code: number } };
  }
  async function tool(name: string, args = {}) {
    const response = await call("tools/call", { name, arguments: args });
    expect(response.result?.isError, JSON.stringify(response)).not.toBe(true);
    return response.result?.structuredContent!;
  }
  async function sign(changes: Record<string, unknown> = {}, header = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sub: "sites-scoped-user", email: "admin@example.test", iss: issuer, aud: env.KAKEIBO_MCP_URL, iat: now, exp: now + 60, jti: crypto.randomUUID(), ...changes })
      .setProtectedHeader({ alg: "ES256", typ: "kakeibo-sites+jwt", kid, ...header }).sign(pair.privateKey);
  }
  return { household, env, issuer, pair, kid, call, tool, sign };
}

describe("Sites household connection", () => {
  it("uses the existing household user for authenticated category, tag, asset and import operations through both MCP servers", async () => {
    const f = await fixture();
    expect((await f.call("server/discover")).result).toMatchObject({ supportedVersions: ["2026-07-28"] });
    expect((await f.call("tools/list", {}, null)).result?.tools).toHaveLength(17);
    const category = await f.tool("createCategory", { code: "sites-test", name: "接続テスト", kind: "expense" });
    expect(await f.tool("updateCategory", { id: category.id, name: "接続テスト変更" })).toMatchObject({ name: "接続テスト変更" });
    const tag = await f.tool("createTag", { name: "接続テストタグ" });
    expect(await f.tool("updateTag", { id: tag.id, name: "接続テストタグ変更" })).toMatchObject({ name: "接続テストタグ変更" });
    const asset = await f.tool("createFinancialAsset", { name: "接続テスト預金", assetType: "bank_deposit", currency: "USD", valuationMinor: 123 });
    expect(asset.ownerUserId).toBe("usr_existing_admin");
    expect(await f.tool("updateFinancialAsset", { id: asset.id, name: "接続テスト資産変更" })).toMatchObject({ currency: "USD", valuationMinor: 123 });
    expect(await f.tool("deleteFinancialAsset", { id: asset.id })).toMatchObject({ isActive: false });
    const input = { sourceType: "receipt", idempotencyKey: "sites-receipt", items: [{ entryType: "expense", entryDate: "2026-10-24", amount: 100, categoryCodeGuess: "sites-test", tags: ["接続テストタグ変更"] }] };
    const receipt = await f.tool("createEntrySource", input);
    expect(await f.tool("createEntrySource", input)).toEqual(receipt);
    expect(await f.tool("getInsightOverview", { from: "2026-10-24", to: "2026-10-24" })).toMatchObject({ expenseTotal: 0 });
    expect(await f.tool("deleteCategory", { id: category.id })).toMatchObject({ mode: "deactivated" });
    expect(await f.tool("deleteTag", { id: tag.id })).toMatchObject({ mode: "deactivated" });
    expect(await f.household.repositories.users.listActive()).toHaveLength(1);
    expect((await f.household.repositories.users.findById("usr_existing_admin"))?.role).toBe("admin");
  });

  it("rejects invalid issuer, resource, type, key identifier, lifetime and missing identity claims", async () => {
    const f = await fixture();
    const now = Math.floor(Date.now() / 1000);
    for (const [claims, header] of [
      [{ iss: "https://wrong.example" }, {}], [{ aud: "https://other.example/mcp" }, {}],
      [{}, { typ: "JWT" }], [{}, { kid: "wrong-key" }],
      [{ iat: now - 120, exp: now - 60 }, {}], [{ exp: now + 3600 }, {}],
      [{ iat: now + 60, exp: now + 120 }, {}], [{ email: undefined }, {}]
    ] as [Record<string, unknown>, Record<string, unknown>][]) {
      const response = await f.household.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${await f.sign(claims, header)}` } });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("invalid_token");
    }
    const other = await generateKeyPair("ES256");
    const wrongKey = await new SignJWT({ email: "admin@example.test" }).setProtectedHeader({ alg: "ES256", typ: "kakeibo-sites+jwt", kid: f.kid }).setSubject("sites-user").setIssuer(f.issuer).setAudience(f.env.KAKEIBO_MCP_URL).setIssuedAt().setExpirationTime("60s").setJti(crypto.randomUUID()).sign(other.privateKey);
    expect((await f.household.request("/mcp", { headers: { Authorization: `Bearer ${wrongKey}` } })).status).toBe(401);
  });

  it("tolerates a small clock difference between the two authenticated servers", async () => {
    const f = await fixture();
    const now = Math.floor(Date.now() / 1000);
    const client = await f.household.connect(await f.sign({ iat: now + 2, exp: now + 62 }));
    try { expect((await client.listTools()).tools).toHaveLength(17); }
    finally { await client.close(); }
  });

  it("requires Sites identity and a unique active household user instead of creating another user", async () => {
    const f = await fixture();
    expect((await f.call("tools/call", { name: "getTaxonomy" }, null)).result?.isError).toBe(true);
    await f.household.repositories.users.upsertAccessUser({ id: "duplicate", displayName: "admin@example.test", role: "admin" });
    expect((await f.call("tools/call", { name: "getTaxonomy" })).result?.isError).toBe(true);
    f.household.repositories.users.rows.clear();
    expect((await f.call("tools/call", { name: "getTaxonomy" })).result?.isError).toBe(true);
    expect(await f.household.repositories.users.listActive()).toEqual([]);
  });

  it("applies current admin and household membership on every tool call", async () => {
    const f = await fixture();
    f.household.env.ADMIN_EMAILS = "other@example.test";
    const denied = await f.call("tools/call", { name: "createCategory", arguments: { code: "forbidden", name: "拒否", kind: "expense" } });
    expect(denied.result?.isError).toBe(true);
    expect(JSON.stringify(denied.result?.content)).toContain("管理者権限");
    expect(await f.household.repositories.taxonomy.listCategories()).toEqual([]);
    expect(await f.tool("createFinancialAsset", { name: "member asset", assetType: "cash" })).toHaveProperty("id");
    f.household.env.HOUSEHOLD_EMAILS = "";
    expect((await f.call("tools/call", { name: "getTaxonomy" })).result?.isError).toBe(true);
  });

  it("rejects unsupported tool names and oversized requests without contacting the household", async () => {
    const f = await fixture();
    expect((await f.call("tools/call", { name: "deleteEntry" })).error?.code).toBe(-32602);
    const oversized = await connection.fetch(new Request(`${f.issuer}/mcp`, { method: "POST", body: "x".repeat(256 * 1024 + 1) }), f.env);
    expect(await oversized.json()).toMatchObject({ error: { code: -32600 } });
    expect((await connection.fetch(new Request(`${f.issuer}/oauth/token`), f.env)).status).toBe(404);
    expect((await connection.fetch(new Request(`${f.issuer}/mcp`), f.env)).status).toBe(405);
  });

  it("does not mint credentials without a verified Sites caller or for insecure upstream settings", async () => {
    const f = await fixture();
    expect(await sitesBearer(new Request(`${f.issuer}/mcp`), f.env)).toBeNull();
    const request = new Request(`${f.issuer}/mcp`, { headers: { "oai-authenticated-user-id": "user", "oai-authenticated-user-email": "admin@example.test" } });
    await expect(sitesBearer(request, { ...f.env, KAKEIBO_MCP_URL: "http://insecure.example/mcp" })).rejects.toThrow();
  });
});
