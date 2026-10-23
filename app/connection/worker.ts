import { Client, StreamableHTTPClientTransport, InsufficientScopeError } from "@modelcontextprotocol/client";
import { importJWK, SignJWT } from "jose";
import { z } from "zod";
import catalog from "./generated/tools.json";

export interface ConnectionEnv {
  KAKEIBO_SITE_ORIGIN: string;
  KAKEIBO_MCP_URL: string;
  KAKEIBO_SIGNING_PRIVATE_JWK: string;
}

const rpcSchema = z.object({
  jsonrpc: z.literal("2.0"), id: z.union([z.string(), z.number()]).optional(),
  method: z.string(), params: z.record(z.string(), z.unknown()).optional()
});
const callSchema = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()).default({}) });
const privateKeySchema = z.object({
  kty: z.literal("EC"), crv: z.literal("P-256"), x: z.string(), y: z.string(),
  d: z.string().min(1), kid: z.string().min(1)
});
const allowedTools = new Set(catalog.tools.map((tool) => tool.name));

export async function sitesBearer(request: Request, env: ConnectionEnv) {
  const subject = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!subject || !z.string().email().safeParse(email).success) return null;
  const issuer = new URL(env.KAKEIBO_SITE_ORIGIN);
  const target = new URL(env.KAKEIBO_MCP_URL);
  if (issuer.protocol !== "https:" || issuer.origin !== env.KAKEIBO_SITE_ORIGIN || target.protocol !== "https:" || target.pathname !== "/mcp" || target.search || target.hash) {
    throw new Error("Invalid connection origin");
  }
  const jwk = privateKeySchema.parse(JSON.parse(env.KAKEIBO_SIGNING_PRIVATE_JWK));
  const key = await importJWK(jwk, "ES256");
  return new SignJWT({ email: email!.trim().toLowerCase() })
    .setProtectedHeader({ alg: "ES256", typ: "kakeibo-sites+jwt", kid: jwk.kid })
    .setSubject(subject).setIssuer(issuer.origin).setAudience(target.href)
    .setIssuedAt().setExpirationTime("60s").setJti(crypto.randomUUID()).sign(key);
}

async function forwardTool(name: string, args: Record<string, unknown>, token: string, env: ConnectionEnv) {
  const client = new Client({ name: "zubora-kakeibo-sites", version: "0.3.0" });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(env.KAKEIBO_MCP_URL), {
      authProvider: { token: async () => token },
      fetch: async (input, init) => {
        const response = await fetch(input, { ...init, signal: AbortSignal.timeout(20000), redirect: "manual" });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new Error("Unexpected household redirect");
        }
        return response;
      }
    }));
    return await client.callTool({ name, arguments: args });
  } catch (error) {
    console.warn(JSON.stringify({ event: "household_upstream_failed", errorType: error instanceof Error ? error.name : "unknown" }));
    if (error instanceof InsufficientScopeError) {
      return { isError: true, content: [{ type: "text", text: "この操作を行う権限がありません。カテゴリ・タグの変更には家計簿の管理者権限が必要です。" }] };
    }
    return { isError: true, content: [{ type: "text", text: "家計簿へ接続できませんでした。利用者登録と接続設定を確認し、書き込み結果が不明な場合は重複登録を避けてください。" }] };
  } finally {
    await client.close().catch(() => undefined);
  }
}

async function boundedJson(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing request body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 256 * 1024) { await reader.cancel(); throw new Error("Request is too large"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

export default {
  async fetch(request: Request, env: ConnectionEnv): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/" && request.method === "GET") {
      return new Response("<!doctype html><html lang=ja><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'><title>ズボラ家計簿</title><main><h1>ズボラ家計簿</h1><p>ChatGPTのプラグインから家計簿を利用できるよ。</p><p>取り込んだ明細は、管理画面で確認・訂正して確定してね。</p><a href='https://zubora-kakeibo.packagelockjson2525.workers.dev'>家計簿の管理画面を開く</a></main></html>", { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'self' https://chatgpt.com" } });
    }
    if (path !== "/mcp") return new Response("Not found", { status: 404 });
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
    const reply = (id: string | number | null, value: object) => Response.json({ jsonrpc: "2.0", id, ...value }, { headers: { "Cache-Control": "private, no-store" } });
    const parsed = await boundedJson(request).then((value) => rpcSchema.safeParse(value)).catch(() => null);
    if (!parsed?.success) return reply(null, { error: { code: -32600, message: "Invalid request" } });
    const { id, method, params } = parsed.data;
    if (id === undefined) return new Response(null, { status: 202 });
    if (method === "server/discover") return reply(id, { result: { supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, serverInfo: { name: "zubora-kakeibo", version: "0.3.0" }, instructions: catalog.instructions } });
    if (method === "initialize") return reply(id, { result: { protocolVersion: "2026-07-28", capabilities: { tools: {} }, serverInfo: { name: "zubora-kakeibo", version: "0.3.0" }, instructions: catalog.instructions } });
    if (method === "ping") return reply(id, { result: {} });
    if (method === "tools/list") return reply(id, { result: { tools: catalog.tools } });
    if (method !== "tools/call") return reply(id, { error: { code: -32601, message: "Method not found" } });
    const input = callSchema.safeParse(params);
    if (!input.success || !allowedTools.has(input.data.name)) return reply(id, { error: { code: -32602, message: "Unknown tool or invalid arguments" } });
    try {
      const token = await sitesBearer(request, env);
      if (!token) return reply(id, { result: { isError: true, content: [{ type: "text", text: "ChatGPTにログインしてプラグインを接続してください。" }] } });
      return reply(id, { result: await forwardTool(input.data.name, input.data.arguments, token, env) });
    } catch (error) {
      console.error(JSON.stringify({ event: "household_connection_failed", errorType: error instanceof Error ? error.name : "unknown" }));
      return reply(id, { result: { isError: true, content: [{ type: "text", text: "家計簿の接続設定が不完全です。管理者に確認してください。" }] } });
    }
  }
};
