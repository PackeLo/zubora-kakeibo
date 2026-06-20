import type { Context } from "hono";
import type { Actor, Role } from "../../domain/types";
import type { Env } from "../../worker/bindings";
import { AppError } from "../../application/errors";

export function webActor(c: Context<{ Bindings: Env }>): Actor {
  const url = new URL(c.req.url);
  const isLocal = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  const allowDevAuth = c.env.ALLOW_DEV_AUTH === "true" || isLocal;
  const accessEmail = c.req.header("Cf-Access-Authenticated-User-Email");
  const accessJwt = c.req.header("Cf-Access-Jwt-Assertion");
  const email = accessEmail && accessJwt ? accessEmail : allowDevAuth ? c.req.header("X-User-Email") ?? "local@example.test" : null;
  if (!email) {
    throw new AppError("UNAUTHORIZED", "Cloudflare Access authentication is required");
  }
  const adminEmails = new Set((c.env.ADMIN_EMAILS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  const localRole = allowDevAuth ? normalizeRole(c.req.header("X-User-Role")) : null;
  const role = localRole ?? (adminEmails.has(email.toLowerCase()) || adminEmails.size === 0 && allowDevAuth ? "admin" : "member");
  return {
    id: `usr_${email.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    displayName: email,
    role
  };
}

export function requireAdmin(actor: Actor): void {
  if (actor.role !== "admin") {
    throw new AppError("FORBIDDEN", "admin role is required");
  }
}

export function requireActionToken(c: Context<{ Bindings: Env }>): Actor {
  const expected = c.env.GPT_ACTION_TOKEN;
  if (!expected) {
    throw new AppError("UNAUTHORIZED", "GPT_ACTION_TOKEN is not configured");
  }
  const actual = c.req.header("Authorization");
  if (actual !== `Bearer ${expected}`) {
    throw new AppError("UNAUTHORIZED", "invalid action token");
  }
  return {
    id: "usr_chatgpt_action",
    displayName: "ChatGPT Actions",
    role: "member"
  };
}

function normalizeRole(value?: string): Role | null {
  if (value === "admin" || value === "member") return value;
  return null;
}
