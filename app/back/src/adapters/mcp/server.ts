import { createMcpHandler } from "agents/mcp/server";
import { localhostAllowedHostnames } from "@modelcontextprotocol/server";
import type { OAuthResourceContext } from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import { accessIdentitySchema, actorFromIdentity } from "../auth/auth";
import { AppError } from "../../application/errors";
import type { UnitOfWork } from "../../ports/repositories";
import type { Env } from "../../worker/bindings";
import { createUseCases } from "../../worker/bootstrap";
import { createToolServer } from "./tools";
import { actorFromSitesIdentity, sitesIdentitySchema, sitesScopes } from "../auth/sites-token";

function hasOAuthContext(ctx: ExecutionContext): ctx is OAuthResourceContext<unknown> {
  return "auth" in ctx;
}

export function createMcpEndpoint(factory: (env: Env) => UnitOfWork) {
  return {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
      try {
        if (!hasOAuthContext(ctx)) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
        const resource = `${env.PUBLIC_ORIGIN}/mcp`;
        if (ctx.auth.audience !== resource) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
        const identity = z.union([sitesIdentitySchema, accessIdentitySchema]).parse(ctx.props);
        const repositories = factory(env);
        const isSites = "kind" in identity;
        const actor = isSites ? await actorFromSitesIdentity(identity, env, repositories) : actorFromIdentity(identity, env);
        const useCases = createUseCases(repositories, env);
        await useCases.currentUser(actor);
        const scopes = isSites ? sitesScopes(actor) : ctx.auth.scope;
        const clientId = isSites ? identity.issuer : ctx.auth.clientId;
        if (!clientId) throw new Error("OAuth client identity is missing");
        const hostname = new URL(resource).hostname;
        const local = ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
        const handler = createMcpHandler(({ authInfo }) => createToolServer(useCases, actor, authInfo?.scopes ?? [], resource), {
          route: "/mcp",
          allowedHostnames: local ? localhostAllowedHostnames() : [hostname],
          allowedOriginHostnames: [...(local ? localhostAllowedHostnames() : [hostname]), "chatgpt.com"],
          onerror: (error) => console.error(JSON.stringify({ event: "mcp_request_failed", errorType: error.name }))
        });
        return await handler.fetch(request, { authInfo: {
          token: ctx.auth.token,
          clientId,
          scopes,
          expiresAt: isSites ? identity.expiresAt : ctx.auth.expiresAt,
          resource: new URL(resource),
          extra: { props: identity }
        } });
      } catch (error) {
        if (error instanceof AppError) return Response.json({ error: error.code, message: error.message }, { status: error.status });
        if (error instanceof z.ZodError) return Response.json({ error: "UNAUTHORIZED" }, { status: 401 });
        throw error;
      }
    }
  };
}
