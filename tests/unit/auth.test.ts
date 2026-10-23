// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApiApp } from "@back/adapters/http/app";
import { InMemoryUnitOfWork } from "@back/adapters/memory/InMemoryRepositories";
import type { Env } from "@back/worker/bindings";
import { accessFixture } from "../helpers/access";

afterEach(() => vi.restoreAllMocks());

function testApp(env: Partial<Env> = {}) {
  const repos = new InMemoryUnitOfWork();
  const app = createApiApp(() => repos);
  return {
    request: (url: string, headers: Record<string, string> = {}) => app.request(url, { headers }, {
      DB: {} as D1Database,
      ALLOW_DEV_AUTH: "false",
      LIVE_COMPLETED_YEARS_TO_KEEP: "3",
      ...env
    })
  };
}

describe("web authentication", () => {
  it("derives identity and admin role from the verified token and configured emails", async () => {
    const fixture = await accessFixture();
    const app = testApp(fixture.env);
    const response = await app.request("https://app.example.test/api/me", await fixture.headers());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "usr_access_test-user", displayName: "admin@example.test", role: "admin" });
    expect(fixture.fetchMock).toHaveBeenCalledTimes(1);
    await app.request("https://app.example.test/api/me", await fixture.headers());
    expect(fixture.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores forged email and role headers on public hosts", async () => {
    const fixture = await accessFixture();
    const app = testApp({ ...fixture.env, ALLOW_DEV_AUTH: "true" });
    const response = await app.request("https://app.example.test/api/me", {
      ...await fixture.headers({ email: "member@example.test" }),
      "Cf-Access-Authenticated-User-Email": "admin@example.test",
      "X-User-Email": "admin@example.test",
      "X-User-Role": "admin"
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ displayName: "member@example.test", role: "member" });
  });

  it.each([
    { exp: 1 },
    { iss: "https://other.cloudflareaccess.com" },
    { aud: "other-application" },
    { email: "not-an-email" },
    { email: undefined },
    { sub: undefined },
    { exp: undefined },
    { iat: undefined },
    { nbf: Math.floor(Date.now() / 1000) + 300 }
  ])("rejects invalid claims: %j", async (claims) => {
    const fixture = await accessFixture();
    const response = await testApp(fixture.env).request("https://app.example.test/api/me", await fixture.headers(claims));
    expect(response.status).toBe(401);
  });

  it("rejects a JWT signed by a different key", async () => {
    const untrusted = await accessFixture();
    untrusted.fetchMock.mockRestore();
    const trusted = await accessFixture();
    const response = await testApp(trusted.env).request("https://app.example.test/api/me", await untrusted.headers({ iss: trusted.issuer, aud: trusted.audience }));
    expect(response.status).toBe(401);
  });

  it("rejects arbitrary Access headers", async () => {
    const fixture = await accessFixture();
    const response = await testApp(fixture.env).request("https://app.example.test/api/me", {
      "Cf-Access-Authenticated-User-Email": "admin@example.test",
      "Cf-Access-Jwt-Assertion": "jwt"
    });
    expect(response.status).toBe(401);
  });

  it("rejects tokens when the Access application is not configured", async () => {
    const fixture = await accessFixture();
    const response = await testApp().request("https://app.example.test/api/me", await fixture.headers());
    expect(response.status).toBe(401);
    expect(fixture.fetchMock).not.toHaveBeenCalled();
  });

  it.each(["http://localhost", "http://127.0.0.1", "http://[::1]"])("requires explicit development auth at %s", async (origin) => {
    expect((await testApp().request(`${origin}/api/me`)).status).toBe(401);
    const response = await testApp({ ALLOW_DEV_AUTH: "true" }).request(`${origin}/api/me`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ displayName: "local@example.test", role: "admin" });
  });

  it("rejects development auth on a public host", async () => {
    const response = await testApp({ ALLOW_DEV_AUTH: "true" }).request("https://app.example.test/api/me", { "X-User-Role": "admin" });
    expect(response.status).toBe(401);
  });

  it("does not grant admin APIs to members", async () => {
    const fixture = await accessFixture();
    const response = await testApp(fixture.env).request("https://app.example.test/api/admin/archive-years", await fixture.headers({ email: "member@example.test" }));
    expect(response.status).toBe(403);
  });
});
