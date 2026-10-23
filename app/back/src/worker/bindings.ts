/// <reference path="./generated-env.d.ts" />

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

type OptionalBinding = "ASSETS" | "OAUTH_KV" | "PUBLIC_ORIGIN" | "GPT_ACTION_TOKEN" | "ADMIN_EMAILS" | "HOUSEHOLD_EMAILS" | "CF_ACCESS_TEAM_DOMAIN" | "CF_ACCESS_AUD" | "SITES_TOKEN_ISSUER" | "SITES_TOKEN_PUBLIC_JWK";

export type Env = Omit<WorkerBindings, OptionalBinding> & Partial<Pick<WorkerBindings, OptionalBinding>> & {
  OAUTH_PROVIDER?: OAuthHelpers;
};
