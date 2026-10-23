// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { oauthFixture } from "../helpers/oauth";

afterEach(() => vi.restoreAllMocks());

describe("MCP OAuth", () => {
  it("links a CIMD client without dynamic registration", async () => {
    const fixture = await oauthFixture();
    const clientId = `https://clients.example.test/${crypto.randomUUID()}.json`;
    const originalFetch = fixture.access.fetchMock.getMockImplementation()!;
    fixture.access.fetchMock.mockImplementation(async (input, init) => {
      if (String(input) === clientId) return Response.json({
        client_id: clientId, client_name: "Metadata client",
        redirect_uris: fixture.client.redirectUris,
        grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
        token_endpoint_auth_method: "none"
      });
      return originalFetch(input, init);
    });
    fixture.client.clientId = clientId;
    const { tokens } = await fixture.login();
    const client = await fixture.connect(tokens.access_token);
    try { expect((await client.listTools()).tools).toHaveLength(17); }
    finally { await client.close(); }
  });

  it("publishes discovery and rejects unauthenticated MCP requests without serving the SPA", async () => {
    const fixture = await oauthFixture();
    const resource = await fixture.request("/.well-known/oauth-protected-resource/mcp");
    expect(resource.status).toBe(200);
    expect(await resource.json()).toMatchObject({ resource: `${fixture.origin}/mcp`, authorization_servers: [fixture.origin] });
    const metadata = await fixture.request("/.well-known/oauth-authorization-server");
    expect(await metadata.json()).toMatchObject({ issuer: fixture.origin, code_challenge_methods_supported: ["S256"], client_id_metadata_document_supported: true });
    for (const value of ["", "Bearer invalid"]) {
      const headers = new Headers();
      if (value) headers.set("Authorization", value);
      const response = await fixture.request("/mcp", { method: "POST", headers });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("resource_metadata");
    }
    expect((await fixture.request("/oauth/unknown")).status).toBe(404);
    expect((await fixture.request("/.well-known/unknown")).status).toBe(404);
    expect((await fixture.request("/authorize", { headers: { "Cf-Access-Authenticated-User-Email": "admin@example.test" } })).status).toBe(401);
  });

  it("binds consent to the browser, supports denial, and issues no grant for a forged form", async () => {
    const fixture = await oauthFixture();
    const denied = await fixture.consent();
    expect(denied.shown.status).toBe(200);
    expect(denied.html).toContain("chatgpt.com");
    const response = await denied.submit("deny");
    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("original-state");
    expect(redirect.searchParams.get("iss")).toBe(fixture.origin);
    const forged = await fixture.consent();
    expect((await forged.submit("approve", { Cookie: "" })).status).toBe(400);
    const switched = await fixture.consent();
    expect((await switched.submit("approve", await fixture.access.headers({ email: "member@example.test", sub: "another-user" }))).status).toBe(400);
  });

  it("requires PKCE and refuses authorization-code reuse", async () => {
    const fixture = await oauthFixture();
    const flow = await fixture.consent();
    const approved = await flow.submit("approve");
    const redirect = new URL(approved.headers.get("location")!);
    const incorrect = new URLSearchParams({ grant_type: "authorization_code", client_id: fixture.client.clientId, redirect_uri: fixture.client.redirectUris[0], resource: `${fixture.origin}/mcp`, code: redirect.searchParams.get("code")!, code_verifier: "wrong-verifier-" + "x".repeat(48) });
    expect((await fixture.request("/oauth/token", { method: "POST", body: incorrect })).status).toBe(400);
    const valid = await fixture.login();
    expect(valid.redirect.searchParams.get("iss")).toBe(fixture.origin);
    expect((await fixture.request("/oauth/token", { method: "POST", body: valid.body })).status).toBe(400);
  });

  it("refreshes and revokes grants, and rejects tokens for a different resource", async () => {
    const fixture = await oauthFixture();
    const { tokens } = await fixture.login(["kakeibo:read", "offline_access"]);
    const refresh = await fixture.request("/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: fixture.client.clientId, resource: `${fixture.origin}/mcp`, refresh_token: tokens.refresh_token }) });
    expect(refresh.status).toBe(200);
    const renewed = await refresh.json() as { access_token: string; refresh_token: string };
    const client = await fixture.connect(renewed.access_token);
    expect((await client.listTools()).tools).toHaveLength(17);
    await client.close();
    const wrongResource = await fixture.request("/oauth/token", { method: "POST", body: new URLSearchParams({ grant_type: "refresh_token", client_id: fixture.client.clientId, resource: "https://other.example.test/mcp", refresh_token: renewed.refresh_token }) });
    expect(wrongResource.status).toBe(400);
    const metadata = await (await fixture.request("/.well-known/oauth-authorization-server")).json() as { revocation_endpoint: string };
    const revoked = await fixture.request(metadata.revocation_endpoint, { method: "POST", body: new URLSearchParams({ client_id: fixture.client.clientId, token: renewed.refresh_token, token_type_hint: "refresh_token" }) });
    expect(revoked.status).toBe(200);
    const response = await fixture.request("/mcp", { method: "POST", headers: { Authorization: `Bearer ${renewed.access_token}` } });
    expect(response.status).toBe(401);
  });

  it("does not grant taxonomy management to members or accept a forged callback", async () => {
    const fixture = await oauthFixture();
    expect((await fixture.consent(["kakeibo:read", "kakeibo:taxonomy:write"], "member@example.test")).shown.status).toBe(403);
    const url = new URL("/authorize", fixture.origin);
    url.search = new URLSearchParams({ client_id: fixture.client.clientId, response_type: "code", redirect_uri: "https://attacker.example.test/callback", resource: `${fixture.origin}/mcp`, scope: "kakeibo:read", code_challenge: "x".repeat(43), code_challenge_method: "S256" }).toString();
    const response = await fixture.request(url.href, { headers: await fixture.access.headers() });
    expect(response.status).toBe(400);
    expect(response.headers.has("location")).toBe(false);
  });
});
