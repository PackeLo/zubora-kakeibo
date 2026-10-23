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

ローカルでは `.dev.vars` を作成する。このファイルはGit管理外。

```text
GPT_ACTION_TOKEN=local-token
ADMIN_EMAILS=local@example.test
HOUSEHOLD_EMAILS=local@example.test
CF_ACCESS_TEAM_DOMAIN=https://local.cloudflareaccess.com
CF_ACCESS_AUD=local-only
```

`pnpm dev` が開発用認証の `ALLOW_DEV_AUTH=true` を明示的に指定する。この認証は localhost / 127.0.0.1 / ::1 の場合だけ有効。公開設定の `ALLOW_DEV_AUTH` は常に `false`。
通常APIは最初のアクセス時にローカルユーザーを登録する。フロントの初期表示には `/api/me` と `/api/users` を使用する。

## 運用フロー

1. ChatGPTのMCPプラグインがカテゴリ・タグを取得し、レシートなどの内容と推定分類を下書き登録する。カテゴリ・タグの管理と金融資産の管理もプラグインから行える。
2. 登録された明細は確認待ちの下書きとなり、この時点では集計に含まれない。
3. 管理画面の「登録元明細」で種別・日付・金額・対象者・カテゴリ・タグ・用途・メモを修正する。「下書き保存」で確認待ちのまま保存できる。
4. 「確認して確定」で家計簿へ登録する。支出はカテゴリ必須。対象者はログイン済みユーザーから選ぶ。家族を選択肢に追加するには、その家族が一度管理画面にログインする。
5. 確定した明細がダッシュボードとMCPの集計に反映される。

推定タグは名前で既存の有効タグと照合する。未登録・無効なタグがある場合、管理者が「カテゴリ・タグ」で登録するか、確認画面で明示的に外してから確定する。未登録のタグは自動作成しない。

## テスト

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

Access JWT、OAuthのPKCE・同意・更新・失効、MCPクライアントを通した17ツール、権限境界、分類・資産管理、未確定明細の訂正・確定・集計、画面でのタグ引継ぎを検証する。通常の統合テストはメモリ上のリポジトリを使うため、D1/KVの確認は別途ローカルWorkerで行う。

## 初回Cloudflareデプロイ

公開先: `https://zubora-kakeibo.packagelockjson2525.workers.dev`。
対象アカウントとD1 IDは `wrangler.toml` に固定している。

Workerのログを全件、トレースを10%サンプリングで収集する。アプリのエラーログにリクエスト本文や認証情報を含めない。
設定のバインディング・Secret名を変更した場合は `corepack pnpm types:generate` で型を再生成する。Secretは `[secrets].required` に名前だけを宣言し、未設定時のAPIは認証を拒否する。

### 1. アカウントとD1

```bash
corepack pnpm exec wrangler login
corepack pnpm exec wrangler whoami
corepack pnpm exec wrangler d1 list
```

既存のD1を使う場合は対象を確認する。新規作成する場合は以下を実行し、返されたIDを `wrangler.toml` の `database_id` に設定する。

```bash
corepack pnpm exec wrangler d1 create zubora-kakeibo
```

### 2. Cloudflare Access

Zero TrustでSelf-hostedアプリケーションを作成する。公開ホストを `zubora-kakeibo.<account-subdomain>.workers.dev` とした場合の設定:

| 対象 | ポリシー |
|---|---|
| 公開ホスト全体 | 家族のメールアドレスをAllowする。メールのワンタイムPINなどでログイン |
| `/authorize` | ホスト全体の家族Allowを適用する。OAuthの接続許可画面 |
| `/mcp`、`/.well-known/*`、`/oauth/*` | より具体的な別アプリケーションとしてBypassする。MCPはOAuthトークン、OAuth経路はプロトコルによる検証で保護 |

ホスト全体をWorker単位で一律に保護すると、ChatGPTのMCP通信がログインHTMLに遮られる。パスごとのSelf-hostedアプリケーションで設定し、MCP通信・認証情報の公開・トークン交換だけを例外にする。通常APIと`/authorize`用のAudience (AUD)と、Zero Trustのチームドメイン `https://<team>.cloudflareaccess.com` を控える。

WorkerはAccess JWTの署名、issuer、audience、有効期限、ユーザー識別子とメールを検証する。単なる `Cf-Access-Authenticated-User-Email` ヘッダーではログインできない。Access設定に漏れた別URLから通常APIへ到達しても、有効なJWTがなければ拒否する。公開バージョンプレビューURLは `preview_urls = false` で無効化している。

参考: [AccessのJWT検証](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)、[アプリケーションのパス優先順位](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/app-paths/)。

### 3. 設定とSecret

次のコマンドは対話入力。値をソース、チャット、コマンド引数へ貼らない。

```bash
corepack pnpm exec wrangler secret put ADMIN_EMAILS
corepack pnpm exec wrangler secret put HOUSEHOLD_EMAILS
corepack pnpm exec wrangler secret put CF_ACCESS_TEAM_DOMAIN
corepack pnpm exec wrangler secret put CF_ACCESS_AUD
```

| 名前 | 値 |
|---|---|
| `ADMIN_EMAILS` | カテゴリ・タグ・アーカイブを管理できるメールアドレスのカンマ区切り |
| `HOUSEHOLD_EMAILS` | 家計簿を利用できる家族のメールアドレスのカンマ区切り。未設定・空なら公開環境の利用を拒否 |
| `CF_ACCESS_TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com`。末尾スラッシュなし |
| `CF_ACCESS_AUD` | 通常APIを保護するAccessアプリケーションのAUD |

これらの名前を `[vars]` に重複定義しない。`ALLOW_DEV_AUTH` は公開環境で `false` にする。通常APIの一般ユーザーは家計の確認・編集と金融資産の変更が可能で、管理者のみカテゴリ・タグの変更とアーカイブ操作が可能。家族を追加する場合は、AccessのAllowと`HOUSEHOLD_EMAILS`の両方を更新する。`ADMIN_EMAILS`に追加しなければ管理者権限は付かない。

OAuth用KVを作成し、`wrangler.toml`の`OAUTH_KV`にIDを設定する。家計のデータを保存するD1とは別の認証用ストレージ。

```bash
corepack pnpm exec wrangler kv namespace create zubora-kakeibo-oauth
corepack pnpm types:generate
```

`PUBLIC_ORIGIN`は公開先のオリジンと完全一致させる。ローカルの`pnpm dev`はlocalhostを指定する。CIMDには`global_fetch_strictly_public`フラグが必要。公開用MCPに固定APIキーは使わない。

### 4. マイグレーションとデプロイ

```bash
corepack pnpm test
corepack pnpm typecheck
pnpm db:migrate:prod
pnpm deploy
```

### 5. 公開後の確認

1. 未ログインのブラウザでは管理画面にAccessログインが表示される。
2. 許可した管理者メールでログインし、カテゴリとタグを作成できる。
3. `/.well-known/oauth-authorization-server`と`/.well-known/oauth-protected-resource/mcp`が公開JSONを返す。`/mcp`は未認証・不正なトークンで401と`WWW-Authenticate`を返す。AccessのログインHTMLが返る場合はパス設定を修正する。
4. ChatGPTでOAuth接続し、17ツールを確認する。テスト用レシート1件を取り込み、画面で分類・タグを訂正して確定し、MCPと画面で集計の金額を照合する。
5. 同じ明細の再確定は409になる。テスト用データは確認後に画面から削除する。

## ChatGPT MCPプラグインとの接続

スマホ用にはSitesの非公開接続アプリを使う。接続サーバーのソースは`app/connection/`。Sitesが確認した本人情報から有効期間60秒の署名JWTを作り、既存Workerの`https://zubora-kakeibo.packagelockjson2525.workers.dev/mcp`へ接続する。家計データは既存D1に保存する。OpenAPIを貼り付ける方式ではない。

1. `corepack pnpm build:connection`で既存の17ツール定義からカタログと接続サーバーを生成する。
2. SitesにMCP capabilityを持つ所有者限定のSiteを作成し、署名秘密鍵をホスト用Secretへ登録する。具体的なランタイム設定は`app/connection/README.md`を参照する。
3. Workerの`SITES_TOKEN_ISSUER`と`SITES_TOKEN_PUBLIC_JWK`に、そのSiteの正確なオリジンと公開鍵を設定する。Workerは署名、発行元、宛先、種類、鍵ID、有効期間、本人情報を検証する。
4. Siteのソースを同期して所有者限定で公開し、Sitesが生成するプラグインをインストール・接続する。MCP設定入りZIPのアップロードはしない。
5. 家計簿の管理画面へ、ChatGPTと同じメールで一度ログインする。Sites経由では既存の有効ユーザーを使い、同じメールに対応するユーザーが0件または複数なら拒否する。権限は現在の`HOUSEHOLD_EMAILS`と`ADMIN_EMAILS`から毎回判定する。
6. スマホで分類の取得とテスト登録を確認し、家族へはSiteとプラグインの両方を限定共有する。PC常時起動やローカルMCP設定は使わない。スマホでの実呼び出しが成功するまでは移行完了扱いにしない。

署名秘密鍵はソース、成果物、`.env`、チャットへ保存しない。鍵を回転・失効する場合はSitesのSecretとWorkerの公開鍵を更新する。APIキーやメールのログインコードをチャットへ貼らない。

直接MCPアプリを作成できる環境では、ChatGPT Webの「Add custom MCP server」へWorkerのURLを登録し、OAuth（CIMD）で接続する方法もある。メニューの提供状況はアカウントごとに確認し、BusinessにEnterprise用の「権限とロール」がある前提では案内しない。

`plugins/zubora-kakeibo/`はMCP設定と利用手順のskillを含む開発用パッケージ。これをZIPでインポートすると、接続先がリモートHTTPSでもDesktop onlyになるため、スマホ向けの導入には使わない。登録済みアプリにskillを添える場合は、そのアプリIDを参照する方式を別途設定する。参照ファイルだけでアプリは新規作成されない。詳細は[公式のインポート制限](https://learn.chatgpt.com/docs/enterprise/plugin-management#desktop-only-plugins)を参照する。

| Scope | 権限 |
|---|---|
| `kakeibo:read` | 分類、ユーザー、資産、確定明細と集計の照会 |
| `kakeibo:import` | 確認待ちの取り込み元と明細の作成 |
| `kakeibo:taxonomy:write` | カテゴリ・タグの作成、編集、削除/無効化。管理者のみ |
| `kakeibo:assets:write` | 家族共有の金融資産の作成、編集、無効化 |
| `offline_access` | 接続の継続利用 |

各ツールはスコープを検査し、分類変更では実行時点の管理者設定も確認する。許可ユーザーから外れたメールは既発行のMCPトークンでも拒否する。Accessの許可メールだけを削除してもOAuthの接続自体は残るため、利用停止時は`HOUSEHOLD_EMAILS`も更新する。接続のトークンは有効期間があり、更新・失効はOAuthライブラリが扱う。

共有先は家族のいるワークスペース内に限定する。接続・アップロード・共有には、それぞれ必要なワークスペース権限がある。会話形式の作成画面が開けるだけでは外部MCP接続の可否は分からない。スマホとWebで使えるプラグインとして、家族のアカウントからインストール・接続を実際に確認する。ローカルmarketplaceやDesktop onlyはこの確認の代用にならない。

公式資料: [カスタムMCP接続](https://developers.openai.com/api/docs/guides/custom-mcp-server)、[OAuth認証](https://developers.openai.com/plugins/build/auth)、[MCPプラグインの検証](https://developers.openai.com/plugins/deploy/connect-chatgpt)。

### 旧Actionsからの切り替え

MCPの受入確認までは旧`/api/action/*`と`GPT_ACTION_TOKEN`の設定が残る。新しい機能はMCP側に追加し、固定キーをプラグインへ渡さない。MCPの本番接続・スマホ・共有の確認後に旧ルート、OpenAPI、Secret宣言と登録済みSecretを撤去する。公開範囲を拡大して旧Actionsを併用する構成にはしない。

## 分類・金融資産のAPI

通常APIはAccess認証と許可ユーザーの検査を行う。MCPからは同じユースケースを利用し、追加のスコープを検査する。

| 操作 | 通常API | MCPツール |
|---|---|---|
| 分類一覧 | `GET /api/taxonomy` | `getTaxonomy` |
| カテゴリ登録 | `POST /api/categories` | `createCategory` |
| カテゴリ編集 | `PATCH /api/categories/:id` | `updateCategory` |
| カテゴリ削除 | `DELETE /api/categories/:id` | `deleteCategory` |
| タグ登録 | `POST /api/tags` | `createTag` |
| タグ編集 | `PATCH /api/tags/:id` | `updateTag` |
| タグ削除 | `DELETE /api/tags/:id` | `deleteTag` |
| 金融資産一覧 | `GET /api/financial-assets` | `listFinancialAssets` |
| 金融資産登録 | `POST /api/financial-assets` | `createFinancialAsset` |
| 金融資産編集 | `PATCH /api/financial-assets/:id` | `updateFinancialAsset` |
| 金融資産削除 | `DELETE /api/financial-assets/:id` | `deleteFinancialAsset` |
| 所有者の選択肢 | `GET /api/users` | `listUsers` |

分類の変更は管理者のみ。カテゴリの登録には`code`、`name`、`kind`（expense/income）、タグには`name`が必要。カテゴリコード・タグ名の重複はCONFLICT。使用中のカテゴリの支出/収入種別は変更できない。使用中のカテゴリ・タグの削除は履歴を保って無効化し、応答の`mode`が`deactivated`になる。未使用なら`deleted`。

資産の登録には`name`と`assetType`が必要。所有者は省略時にログイン本人。`valuationMinor`は通貨の最小単位の整数（JPYなら円）、`quantityText`は保有数量のメモ、`valuationNote`は評価額のメモ。資産削除は物理削除せず`isActive: false`にする。`includeInactive=true`で無効化した分類・資産も照会できる。PATCHは指定した項目だけを変え、通貨・表示順・有効状態など省略した値を初期値へ戻さない。

## Accessを管理画面で設定する場合

WranglerのOAuthログインでWorkersをデプロイできても、Accessの設定を変更する権限があるとは限らない。Access APIの書き込みが403になる場合は、Cloudflare Oneの管理画面から次の構成を作る。

まず Zero Trust > Access controls > Policies で、次の再利用可能ポリシーを作成する。

| Policy name | Action | Include |
|---|---|---|
| `zubora-kakeibo-family` | Allow | Emails: 家計簿を使う家族のメールアドレス。初回検証は管理者1名で開始 |
| `zubora-kakeibo-actions`（既存の再利用ポリシー） | Bypass | Everyone |

次に Access controls > Applications で、Self-hostedアプリケーションを2件設定し、それぞれに上記の既存ポリシーを関連付ける。MCP通信用アプリには3件の公開ホストの経路を設定する。新しいアプリ内で専用ポリシーを作り直す必要はない。

| Application name | Public hostname | Path | 関連付けるポリシー |
|---|---|---|---|
| ズボラ家計簿 | `zubora-kakeibo.packagelockjson2525.workers.dev` | 空欄 | `zubora-kakeibo-family` |
| ズボラ家計簿 MCP | `zubora-kakeibo.packagelockjson2525.workers.dev` | `/mcp` | `zubora-kakeibo-actions` |
| 同じMCPアプリに追加 | 同じホスト | `/.well-known/*` | 同上 |
| 同じMCPアプリに追加 | 同じホスト | `/oauth/*` | 同上 |

管理画面アプリのセッションは24時間、ログイン方式はチームに設定済みのメールコード認証を使用できる。BypassポリシーはMCP通信用アプリだけに関連付ける。`/authorize`をBypassへ含めず、管理画面のAllowで保護する。以前のActionsアプリがあれば、名前をMCPへ変更し`/api/action/*`を上記3経路へ置き換える。

Public hostnamesで「Switch to custom input」を選択すると、DomainとPathが1つのPublic hostname欄にまとまる。MCP用には完全なホストとパスを入力する。例: `zubora-kakeibo.packagelockjson2525.workers.dev/mcp`。いずれも`https://`は付けない。3経路を1つの文字列にまとめず、別の公開ホスト項目として追加する。

作成後、管理画面用の「ズボラ家計簿」をConfigureし、Additional settingsのApplication Audience (AUD) Tagを控えて `CF_ACCESS_AUD` に設定する。Actions用アプリのAUDを使用しない。チーム名を変更済みの場合、`CF_ACCESS_TEAM_DOMAIN` は現在の `https://<team>.cloudflareaccess.com` を使用する。

公式手順: [再利用ポリシーの作成](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/policy-management/)、[アプリの作成](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/)、[AUDの確認](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag)。

## Architecture

Backend code lives under `app/back/src`.

- `domain`: pure rules and types
- `application`: use cases
- `ports`: repository interfaces
- `adapters`: D1, HTTP, auth, memory test adapters
- `worker`: Cloudflare Worker entrypoint

Vue UI lives under `app/front/src`.

Routes and UI do not access D1 directly. SQL is isolated in `app/back/src/adapters/d1`.
