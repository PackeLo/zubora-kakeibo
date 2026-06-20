import { createApiApp } from "../adapters/http/app";
import { D1UnitOfWork } from "../adapters/d1/D1Repositories";
import type { Env } from "./bindings";

const api = createApiApp((env) => new D1UnitOfWork(env.DB));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("zubora-kakeibo assets are not configured", { status: 404 });
  }
};

export { createApiApp };
