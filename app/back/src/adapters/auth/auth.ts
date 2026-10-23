import type { Context } from "hono";
import { timingSafeEqual } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";
import type { Actor, Role } from "../../domain/types";
import type { Env } from "../../worker/bindings";
import { AppError } from "../../application/errors";

export const accessIdentitySchema = z.object({
  sub: z.string().min(1),
  email: z.string().email()
});
export type AccessIdentity = z.infer<typeof accessIdentitySchema>;
const accessKeySets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

export async function webActor(c: Context<{ Bindings: Env }>): Promise<Actor> {
  const url = new URL(c.req.url);
  const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const allowDevAuth = c.env.ALLOW_DEV_AUTH === "true" && isLocal;
  const identity = allowDevAuth
    ? { sub: "", email: c.req.header("X-User-Email") ?? "local@example.test" }
    : await verifiedAccessIdentity(c.req.raw, c.env);
  const email = identity.email.trim().toLowerCase();
  if (!allowDevAuth) requireHouseholdEmail(email, c.env);
  const adminEmails = new Set((c.env.ADMIN_EMAILS ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean));
  const localRole = allowDevAuth ? normalizeRole(c.req.header("X-User-Role")) : null;
  const role = localRole ?? (adminEmails.has(email) || adminEmails.size === 0 && allowDevAuth ? "admin" : "member");
  return {
    id: allowDevAuth ? `usr_${email.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}` : `usr_access_${identity.sub}`,
    displayName: email,
    role
  };
}

export function requireHouseholdEmail(email: string, env: Env): void {
  const allowed = emailSet(env.HOUSEHOLD_EMAILS);
  if (!allowed.has(email.trim().toLowerCase())) {
    throw new AppError("FORBIDDEN", "household access is not allowed");
  }
}

function emailSet(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

export function actorFromIdentity(identity: AccessIdentity, env: Env): Actor {
  const email = identity.email.trim().toLowerCase();
  requireHouseholdEmail(email, env);
  return {
    id: `usr_access_${identity.sub}`,
    displayName: email,
    role: emailSet(env.ADMIN_EMAILS).has(email) ? "admin" : "member"
  };
}

export async function verifiedAccessIdentity(request: Request, env: Env): Promise<AccessIdentity> {
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  const issuer = env.CF_ACCESS_TEAM_DOMAIN;
  const audience = env.CF_ACCESS_AUD;
  if (!token || !issuer || !audience) {
    throw new AppError("UNAUTHORIZED", "Cloudflare Access authentication is required");
  }
  try {
    const issuerUrl = new URL(issuer);
    if (issuerUrl.protocol !== "https:" || issuerUrl.origin !== issuer || !issuerUrl.hostname.endsWith(".cloudflareaccess.com")) {
      throw new Error("invalid Access team domain");
    }
    let keys = accessKeySets.get(issuer);
    if (!keys) {
      keys = createRemoteJWKSet(new URL("/cdn-cgi/access/certs", issuer), { timeoutDuration: 5000 });
      accessKeySets.set(issuer, keys);
    }
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ["RS256"],
      requiredClaims: ["sub", "email", "iat", "exp"]
    });
    return accessIdentitySchema.parse(payload);
  } catch {
    throw new AppError("UNAUTHORIZED", "invalid Cloudflare Access token");
  }
}

export function requireAdmin(actor: Actor): void {
  if (actor.role !== "admin") {
    throw new AppError("FORBIDDEN", "admin role is required");
  }
}

export async function requireActionToken(c: Context<{ Bindings: Env }>): Promise<Actor> {
  const expected = c.env.GPT_ACTION_TOKEN;
  if (!expected) {
    throw new AppError("UNAUTHORIZED", "GPT_ACTION_TOKEN is not configured");
  }
  const actual = c.req.header("Authorization") ?? "";
  const encoder = new TextEncoder();
  const [actualHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(actual)),
    crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${expected}`))
  ]);
  if (!timingSafeEqual(new Uint8Array(actualHash), new Uint8Array(expectedHash))) {
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
