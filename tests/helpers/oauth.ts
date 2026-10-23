import { getOAuthApi } from "@cloudflare/workers-oauth-provider";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { InMemoryUnitOfWork } from "@back/adapters/memory/InMemoryRepositories";
import { oauthOptions } from "@back/adapters/auth/oauth";
import { createMcpEndpoint } from "@back/adapters/mcp/server";
import { createWorker } from "@back/worker/index";
import type { Env } from "@back/worker/bindings";
import { accessFixture } from "./access";

class MemoryKV {
  private rows = new Map<string, { value: string; expires?: number }>();
  async get(key: string | string[], options?: string | { type?: string }): Promise<unknown> {
    if (Array.isArray(key)) return new Map(await Promise.all(key.map(async (name) => [name, await this.get(name, options)] as const)));
    const row = this.rows.get(key);
    if (!row || row.expires && row.expires <= Date.now()) return null;
    const type = typeof options === "string" ? options : options?.type;
    return type === "json" ? JSON.parse(row.value) : row.value;
  }
  async put(key: string, value: string, options?: { expirationTtl?: number; expiration?: number }) {
    this.rows.set(key, { value, expires: options?.expirationTtl ? Date.now() + options.expirationTtl * 1000 : options?.expiration ? options.expiration * 1000 : undefined });
  }
  async delete(key: string) { this.rows.delete(key); }
  async getWithMetadata(key: string | string[], options?: string | { type?: string }): Promise<unknown> {
    return { value: await this.get(key, options), metadata: null, cacheStatus: null };
  }
  async list(options?: { prefix?: string }) {
    return { keys: [...this.rows.keys()].filter((name) => name.startsWith(options?.prefix ?? "")).map((name) => ({ name })), list_complete: true, cacheStatus: null };
  }
}

export async function oauthFixture() {
  const access = await accessFixture();
  const origin = "https://app.example.test";
  const repositories = new InMemoryUnitOfWork();
  const env: Env = {
    ...access.env, DB: {} as D1Database,
    OAUTH_KV: new MemoryKV() as KVNamespace,
    PUBLIC_ORIGIN: origin,
    ALLOW_DEV_AUTH: "false",
    LIVE_COMPLETED_YEARS_TO_KEEP: "3"
  };
  const worker = createWorker(() => repositories);
  const background: Promise<unknown>[] = [];
  class TestSpan {
    readonly isTraced = false;
    setAttribute() {}
    end() {}
  }
  const tracing: Tracing = {
    Span: TestSpan,
    enterSpan: (_name, callback, ...args) => callback(new TestSpan(), ...args),
    startActiveSpan: (_name, callback, ...args) => callback(new TestSpan(), ...args)
  };
  const context = (): ExecutionContext => ({ waitUntil: (promise) => { background.push(promise); }, passThroughOnException: () => {}, props: {}, tracing });
  const send = (input: RequestInfo | URL, init?: RequestInit) => {
    const incoming = new Request(input, init);
    incoming.headers.set("Host", new URL(incoming.url).host);
    return worker.fetch(incoming, env, context());
  };
  const request = (path: string, init?: RequestInit) => send(new URL(path, origin), init);
  const api = getOAuthApi({ ...oauthOptions(origin), apiHandler: createMcpEndpoint(() => repositories), defaultHandler: { fetch: () => new Response(null, { status: 404 }) } }, env);
  const client = await api.createClient({
    clientName: "Household test client",
    redirectUris: ["https://chatgpt.com/connector_platform_oauth_redirect"],
    tokenEndpointAuthMethod: "none",
    grantTypes: ["authorization_code", "refresh_token"],
    responseTypes: ["code"]
  });

  async function consent(scopes = ["kakeibo:read"], email = "admin@example.test") {
    const verifier = "test-pkce-verifier-" + "a".repeat(48);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    const challenge = Buffer.from(digest).toString("base64url");
    const query = new URLSearchParams({
      response_type: "code", client_id: client.clientId,
      redirect_uri: client.redirectUris[0], resource: `${origin}/mcp`,
      scope: scopes.join(" "), state: "original-state", code_challenge: challenge, code_challenge_method: "S256"
    });
    const headers = await access.headers({ email, sub: email });
    const shown = await request(`/authorize?${query}`, { headers });
    const html = await shown.text();
    const handle = html.match(/name="handle" value="([^"]+)"/)?.[1];
    const cookie = shown.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
    async function submit(decision: string, overrides: Record<string, string> = {}) {
      const body = new URLSearchParams({ handle: handle ?? "", decision });
      for (const scope of scopes) body.append("scope", scope);
      return request("/authorize", { method: "POST", headers: { ...headers, Cookie: cookie, ...overrides }, body });
    }
    return { shown, html, handle, submit, verifier, headers, cookie };
  }
  async function login(scopes = ["kakeibo:read"], email = "admin@example.test") {
    const flow = await consent(scopes, email);
    if (flow.shown.status !== 200) throw new Error(`consent failed: ${flow.shown.status}`);
    const approved = await flow.submit("approve");
    if (approved.status !== 302) throw new Error(`approval failed: ${approved.status} ${await approved.text()}`);
    const redirect = new URL(approved.headers.get("location")!);
    const body = new URLSearchParams({
      grant_type: "authorization_code", client_id: client.clientId,
      redirect_uri: client.redirectUris[0], resource: `${origin}/mcp`,
      code: redirect.searchParams.get("code")!, code_verifier: flow.verifier
    });
    const exchanged = await request("/oauth/token", { method: "POST", body });
    const tokens = await exchanged.json() as { access_token: string; refresh_token: string };
    if (exchanged.status !== 200) throw new Error(`code exchange failed: ${exchanged.status}`);
    return { tokens, body, redirect, flow };
  }
  async function connect(token: string) {
    const mcpClient = new Client({ name: "household-test", version: "1.0.0" });
    await mcpClient.connect(new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), {
      authProvider: { token: async () => token },
      fetch: send
    }));
    return mcpClient;
  }
  return { access, origin, env, repositories, request, api, client, consent, login, connect, background };
}
