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
USER_DISPLAY_NAMES_JSON={"local@example.test":"ローカル"}
```

`pnpm dev` が開発用認証の `ALLOW_DEV_AUTH=true` を明示的に指定する。この認証は localhost / 127.0.0.1 / ::1 の場合だけ有効。公開設定の `ALLOW_DEV_AUTH` は常に `false`。
通常APIは最初のアクセス時にローカルユーザーを登録する。フロントの初期表示には `/api/me` と `/api/users` を使用する。

## 運用フロー

1. ChatGPTのMCPプラグインがカテゴリ・タグを取得し、レシートなどの内容と推定分類を下書き登録する。カテゴリ・タグの管理と金融資産の管理もプラグインから行える。
2. 登録された明細は確認待ちの下書きとなり、この時点では集計に含まれない。
3. プラグインの `listEntrySourceItems`・`getEntrySourceItem` で既存の下書きを取得し、`updateEntrySourceItem` でカテゴリ・タグ・日付・金額・対象者・用途・メモを修正できる。タグは名前の配列を指定する。省略は元の値を維持し、空配列はタグ全解除、nullは解除可能な項目を未設定に戻す。編集だけでは集計されない。
4. 信頼度が95%を超え、必須項目・分類が有効で重複候補がなければ、ChatGPTが `postEntrySourceItem` で確定できる。95%ちょうど以下・不明の明細は、管理画面の「登録元明細」で内容を確認し「確認して確定」を押す。「下書き保存」だけでは確定しない。日付・正の整数の金額・通貨・対象者は必須で、支出はカテゴリも必須。推定カテゴリ名の表示だけでは選択済みにならない。対象者はログイン済みユーザーから選ぶ。家族を選択肢に追加するには、その家族が一度管理画面にログインする。
5. 確定した明細がダッシュボードとMCPの集計に反映される。
6. 確定後の訂正は、管理画面の「支出・収入」→明細の「編集」→「変更を保存」を使う。「キャンセル」は保存せず閉じる。プラグインでは `getInsightEntries` で対象を探し、`getEntry` で現在値を取得して `updateEntry` で同じIDを更新する。確定済み編集に信頼度の制限はない。
7. 「詳細」で用途・メモ全文・タグ・対象者・登録者を確認できる。詳細から編集した場合、保存・キャンセル後は詳細へ戻る。メモは改行を保持して表示する。

ダッシュボードは今月の月別表示から始まり、月別／年別を切り替えられる。月別は月初から末日、年別は1月1日から12月31日が対象。年別の月を押すと月別へ、カテゴリやカレンダーの日付を押すと同じ期間・条件の明細へ進む。内訳から詳細・編集へ移動して戻っても、表示していた期間と内訳は保たれる。

検索条件は最初閉じたアコーディオンにまとまる。登録者と対象者を名前で選び、明細と集計を同じ条件で絞り込む。登録者は取り込み元の記録、対象者は明細に指定された人であり、同じ人とは限らない。スマホの明細・資産一覧はカード表示となり、限られた幅の名前は先頭3文字に短縮する。詳細・検索の選択肢には正式名を表示する。

「除外するカテゴリ」「除外するタグ」はチェックで複数選べる。選んだカテゴリに一致するか、選んだタグが1つでも付く明細を、合計・円グラフ・日別/月別集計・明細一覧から除外する。たとえば立替金を外すと、残った支出を100%として円グラフを再計算する。含める条件と重なる明細も除外し、カテゴリ未設定・タグなしはその理由だけでは除外しない。検索を閉じても除外名を表示し、「除外条件を解除」でまとめて戻せる。検索は表示だけに適用し、保存済み明細は変更しない。

HTTPの明細・集計とMCPの概要/月別/カテゴリ/明細ツールでは、`excludedCategoryIds`・`excludedTagIds`に除外するIDの配列を渡す。HTTPはカンマ区切り。空配列・省略は除外なし。カテゴリ・タグの名前は`getTaxonomy`からIDへ対応付ける。

「登録資産の合計（目安）」は金融資産画面に常時表示する。登録済みの評価額だけを通貨別に合計し、異なる通貨を換算せず足し合わせることはしない。資産一覧は種別→資産名順。ダッシュボードの収支とは別に、見たいときに金融資産画面を開いて確認する。

推定タグは名前で既存の有効タグと照合する。未登録・無効なタグがある場合、管理者が「カテゴリ・タグ」で登録するか、確認画面で明示的に外してから確定する。未登録のタグは自動作成しない。

信頼度は取り込み時のモデルの自己評価で、正答率の保証ではない。編集APIで信頼度は変更できない。確定APIは保存済みの値を検査し、不足や重複候補がある場合は理由を返して確認待ちに残す。同じIDの成功後の再送は元の登録結果を返す。確定済み明細は下書き編集APIでは編集できない。編集と確定は更新時点を照合し、競合時は再取得を求める。台帳・タグ・元明細の確定はD1の同じトランザクションで保存する。

確定済みの編集では、取得した `revision` を更新時の `expectedRevision` に指定する。ほかの編集が先に保存されていた場合は409になり、現在値を取り直して変更内容を確認する。台帳・タグ・支出/収入の関連テーブルはまとめて保存され、失敗時は全体が取り消される。入力で省略した値は維持し、`tagIds: []` はタグ全解除、`target`・`memo` のnullは解除を表す。既存の無効カテゴリ・タグを保持したまま他項目を編集できるが、新たに無効な分類へ変更することはできない。アーカイブ済み・書込禁止年は編集できない。

台帳を編集しても、取り込み元明細に残る確定時の値は書き換えない。現在の記録は `getEntry`、取り込み・確定時の記録は `getEntrySourceItem` として区別する。

## テスト

```bash
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build
```

Access JWT、OAuthのPKCE・同意・更新・失効、MCPクライアントを通した23ツール、権限境界、分類・資産管理、未確定明細の取得・訂正・確定・集計、95%の境界と不備時の保留、同時確定・編集競合、確定済みの編集と集計、画面での編集保存・キャンセル・エラー時の入力保持を検証する。通常の統合テストはメモリ上のリポジトリを使うため、D1/KVの確認は別途ローカルWorkerで行う。

## 初回Cloudflareデプロイ

公開先: `https://zubora-kakeibo.packagelockjson2525.workers.dev`。
対象アカウントとD1 IDは `wrangler.toml` に固定している。

Workerのログを全件、トレースを10%サンプリングで収集する。アプリのエラーログにリクエスト本文や認証情報を含めない。
設定のバインディング・Secret名を変更した場合は `corepack pnpm types:generate` で型を再生成する。Secretは `[secrets].required` に名前だけを宣言し、認証に必要な設定が未設定ならAPIは認証を拒否する。

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
corepack pnpm exec wrangler secret put USER_DISPLAY_NAMES_JSON
```

| 名前 | 値 |
|---|---|
| `ADMIN_EMAILS` | カテゴリ・タグ・アーカイブを管理できるメールアドレスのカンマ区切り |
| `HOUSEHOLD_EMAILS` | 家計簿を利用できる家族のメールアドレスのカンマ区切り。未設定・空なら公開環境の利用を拒否 |
| `CF_ACCESS_TEAM_DOMAIN` | `https://<team>.cloudflareaccess.com`。末尾スラッシュなし |
| `CF_ACCESS_AUD` | 通常APIを保護するAccessアプリケーションのAUD |
| `USER_DISPLAY_NAMES_JSON` | 正規メールから正式な表示名へのJSONオブジェクト。例: `{"person@example.test":"名前"}`。認証の許可や本人対応は変更しない |

表示名設定は読み取り時の投影に使い、既存ユーザーの認証用メールや登録者の記録を置き換えない。名前が未設定なら元の表示名を使う。`/api/users`とMCPの`listUsers`はID・表示名・正規メールを返し、`profiles`には表示名設定を返す。`profiles`に名前があるだけでは家計簿の利用権限は付かない。

MCPで登録者を絞る場合は、`listUsers`で得た正式名と正規メールを対応付け、`registeredByEmails`を集計・明細ツールに指定する。対象者の絞り込みは従来どおり`subjectUserIds`を使う。

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
4. ChatGPTでOAuth接続し、23ツールを確認する。テスト用レシート1件を取り込み、分類・タグを訂正して確定し、MCPと画面で集計の金額を照合する。確定後に同じIDの金額やタグを編集し、新規明細が増えず集計が変わることも確認する。低信頼度や不明タグは自動確定されないことも確認する。
5. 同じ明細のWebでの再確定は409になる。MCP確定の成功後の再送は元の登録結果を返す。テスト用データは確認後に画面から削除する。

## ChatGPT MCPプラグインとの接続

スマホ用にはSitesの非公開接続アプリを使う。接続サーバーのソースは`app/connection/`。Sitesが確認した本人情報から有効期間60秒の署名JWTを作り、既存Workerの`https://zubora-kakeibo.packagelockjson2525.workers.dev/mcp`へ接続する。家計データは既存D1に保存する。OpenAPIを貼り付ける方式ではない。

1. `corepack pnpm build:connection`で既存の23ツール定義からカタログと接続サーバーを生成する。
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
| `kakeibo:read` | 分類、ユーザー、資産、取り込み明細と集計の照会 |
| `kakeibo:drafts:write` | 確認待ち明細の編集 |
| `kakeibo:entries:post` | 信頼度95%超の確認待ち明細を検証して確定 |
| `kakeibo:entries:write` | 確定済みの台帳明細を編集 |
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
