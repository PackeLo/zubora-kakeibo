# zubora-kakeibo

ズボラ家計簿 MVP。

## Stack

- TypeScript
- Vue 3 + Vite
- Hono on Cloudflare Workers
- Cloudflare D1
- Zod
- Vitest
- Onion Architecture

## Setup

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
pnpm install
```

## Local development

```bash
pnpm build:front
pnpm db:migrate:local
pnpm dev
```

Vite 単体でフロントを触る場合:

```bash
pnpm dev:front
```

## Required Cloudflare settings

Create a D1 database and replace `database_id` in `wrangler.toml`.

```bash
wrangler d1 create zubora-kakeibo
```

Set the ChatGPT Actions token.

```bash
wrangler secret put GPT_ACTION_TOKEN
```

Set admin emails for Cloudflare Access users.

```bash
wrangler secret put ADMIN_EMAILS
```

For local development, create `.dev.vars` when needed.

```text
GPT_ACTION_TOKEN=local-token
ADMIN_EMAILS=local@example.test
ALLOW_DEV_AUTH=true
```

Apply migrations.

```bash
pnpm db:migrate:prod
```

Deploy.

```bash
pnpm deploy
```

## Architecture

Backend code lives under `app/back/src`.

- `domain`: pure rules and types
- `application`: use cases
- `ports`: repository interfaces
- `adapters`: D1, HTTP, auth, memory test adapters
- `worker`: Cloudflare Worker entrypoint

Vue UI lives under `app/front/src`.

Routes and UI do not access D1 directly. SQL is isolated in `app/back/src/adapters/d1`.
