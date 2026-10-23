import { createApiApp } from "../adapters/http/app";
import { D1UnitOfWork } from "../adapters/d1/D1Repositories";
import type { Env } from "./bindings";
import type { UnitOfWork } from "../ports/repositories";
import { createOAuthProvider } from "../adapters/auth/oauth";
import { handleConsent } from "../adapters/auth/consent";
import { createMcpEndpoint } from "../adapters/mcp/server";

export function createWorker(factory: (env: Env) => UnitOfWork) {
  const api = createApiApp(factory);
  const defaultHandler = {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const path = new URL(request.url).pathname;
      if (path === "/authorize") return handleConsent(request, env, factory(env));
      if (path.startsWith("/api/")) return api.fetch(request, env, ctx);
      if (path.startsWith("/oauth/") || path.startsWith("/.well-known/") || path === "/mcp" || path.startsWith("/mcp/")) {
        return new Response("Not found", { status: 404 });
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("zubora-kakeibo assets are not configured", { status: 404 });
    }
  };
  const apiHandler = createMcpEndpoint(factory);
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);
      const isOAuth = url.pathname === "/mcp" || url.pathname.startsWith("/mcp/") || url.pathname === "/authorize" || url.pathname.startsWith("/oauth/") || url.pathname.startsWith("/.well-known/");
      if (!isOAuth) return defaultHandler.fetch(request, env, ctx);
      if (!env.OAUTH_KV || !env.PUBLIC_ORIGIN) return Response.json({ error: "OAuth is not configured" }, { status: 503 });
      const origin = new URL(env.PUBLIC_ORIGIN);
      const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname);
      if (origin.origin !== env.PUBLIC_ORIGIN || (origin.protocol !== "https:" && !(origin.protocol === "http:" && isLocal))) {
        return Response.json({ error: "Invalid public origin" }, { status: 503 });
      }
      if (url.origin !== origin.origin) return Response.json({ error: "Invalid origin" }, { status: 400 });
      try {
        return await createOAuthProvider(origin.origin, { apiHandler, defaultHandler }).fetch(request, env, ctx);
      } catch (error) {
        console.error(JSON.stringify({ event: "oauth_request_failed", path: url.pathname, errorType: error instanceof Error ? error.name : "unknown" }));
        return Response.json({ error: "INTERNAL_ERROR" }, { status: 500 });
      }
    }
  };
}

export default createWorker((env) => new D1UnitOfWork(env.DB));

export { createApiApp };
