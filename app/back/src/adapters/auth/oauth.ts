import { OAuthProvider, type OAuthProviderOptions } from "@cloudflare/workers-oauth-provider";
import type { Env } from "../../worker/bindings";
import { supportedScopes } from "./scopes";
import { resolveSitesToken } from "./sites-token";

export function oauthOptions(origin: string): Omit<OAuthProviderOptions<Env>, "defaultHandler"> {
  return {
    apiRoute: "/mcp",
    authorizeEndpoint: `${origin}/authorize`,
    tokenEndpoint: `${origin}/oauth/token`,
    resourceMetadata: {
      resource: `${origin}/mcp`,
      resource_name: "ズボラ家計簿",
      authorization_servers: [origin]
    },
    requiredScopes: ["kakeibo:read"],
    scopesSupported: supportedScopes,
    clientIdMetadataDocumentEnabled: true,
    accessTokenTTL: 3600,
    refreshTokenTTL: 60 * 60 * 24 * 30,
    resolveExternalToken: ({ token, env }) => resolveSitesToken(token, env),
    onError: ({ code, status, internal }) => {
      console.warn(JSON.stringify({ event: "oauth_rejected", code, status, reason: internal.reason }));
    }
  };
}

export function createOAuthProvider(origin: string, handlers: Pick<OAuthProviderOptions<Env>, "apiHandler" | "defaultHandler">) {
  return new OAuthProvider<Env>({ ...oauthOptions(origin), ...handlers });
}
