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
    // Muse のカスタムコネクタは DCR (RFC 7591) でクライアント登録するため、CIMD と併用する。
    // 登録自体は無認証でできるが、トークンは /authorize で世帯ログイン (Cloudflare Access の検証 +
    // HOUSEHOLD_EMAILS 照合) を通した承認が無いと発行されないので、登録口を開けても権限は広がらない。
    clientRegistrationEndpoint: "/oauth/register",
    // DCR の登録クライアントは既定だと 90 日 (clientRegistrationTTL) で失効し、接続済みコネクタが
    // 無言で invalid_client になる。CIMD (KV に保存されない) と createClient (無期限) に揃えて無期限にする。
    clientRegistrationTTL: undefined,
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
