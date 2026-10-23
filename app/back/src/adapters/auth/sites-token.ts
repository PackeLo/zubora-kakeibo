import { importJWK, jwtVerify, errors } from "jose";
import { z } from "zod";
import { AppError } from "../../application/errors";
import type { Actor } from "../../domain/types";
import type { UnitOfWork } from "../../ports/repositories";
import type { Env } from "../../worker/bindings";
import { actorFromIdentity } from "./auth";

export const sitesIdentitySchema = z.object({
  kind: z.literal("sites"),
  subject: z.string().min(1),
  email: z.string().email(),
  issuer: z.string().url(),
  expiresAt: z.number().int().positive()
});
export type SitesIdentity = z.infer<typeof sitesIdentitySchema>;

const publicKeySchema = z.object({
  kty: z.literal("EC"), crv: z.literal("P-256"),
  x: z.string().min(1), y: z.string().min(1), kid: z.string().min(1)
}).strict();

export async function resolveSitesToken(token: string, env: Env) {
  if (!env.SITES_TOKEN_ISSUER && !env.SITES_TOKEN_PUBLIC_JWK) return null;
  if (!env.SITES_TOKEN_ISSUER || !env.SITES_TOKEN_PUBLIC_JWK || !env.PUBLIC_ORIGIN) {
    throw new Error("Sites trust configuration is incomplete");
  }
  const issuer = new URL(env.SITES_TOKEN_ISSUER);
  if (issuer.protocol !== "https:" || issuer.origin !== env.SITES_TOKEN_ISSUER) {
    throw new Error("Sites token issuer must be an HTTPS origin");
  }
  const jwk = publicKeySchema.parse(JSON.parse(env.SITES_TOKEN_PUBLIC_JWK));
  const key = await importJWK(jwk, "ES256");
  const audience = `${env.PUBLIC_ORIGIN}/mcp`;
  try {
    const { payload, protectedHeader } = await jwtVerify(token, key, {
      algorithms: ["ES256"], issuer: issuer.origin, audience,
      typ: "kakeibo-sites+jwt", maxTokenAge: "60s", clockTolerance: 5,
      requiredClaims: ["sub", "email", "iat", "exp", "jti"]
    });
    if (protectedHeader.kid !== jwk.kid || typeof payload.iat !== "number" || typeof payload.exp !== "number" ||
        payload.exp <= payload.iat || payload.exp - payload.iat > 60) return null;
    const parsed = sitesIdentitySchema.safeParse({
      kind: "sites", subject: payload.sub, email: payload.email,
      issuer: issuer.origin, expiresAt: payload.exp
    });
    return parsed.success ? { props: parsed.data, audience } : null;
  } catch (error) {
    if (error instanceof errors.JOSEError) return null;
    throw error;
  }
}

export async function actorFromSitesIdentity(identity: SitesIdentity, env: Env, repositories: UnitOfWork): Promise<Actor> {
  const permissions = actorFromIdentity({ sub: identity.subject, email: identity.email }, env);
  const users = (await repositories.users.listActive()).filter((user) => user.displayName.trim().toLowerCase() === permissions.displayName);
  if (users.length !== 1) {
    throw new AppError("FORBIDDEN", "同じメールで家計簿の管理画面にログインし、利用者登録を確認してください。");
  }
  return { ...permissions, id: users[0].id };
}

export function sitesScopes(actor: Actor): string[] {
  const scopes = ["kakeibo:read", "kakeibo:import", "kakeibo:assets:write"];
  if (actor.role === "admin") scopes.push("kakeibo:taxonomy:write");
  return scopes;
}
