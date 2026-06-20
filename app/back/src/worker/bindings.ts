export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  GPT_ACTION_TOKEN?: string;
  ADMIN_EMAILS?: string;
  ALLOW_DEV_AUTH?: string;
  LIVE_COMPLETED_YEARS_TO_KEEP?: string;
}
