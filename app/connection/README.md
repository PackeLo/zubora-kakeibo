# ズボラ家計簿の接続サーバー

Sitesの非公開MCPアプリを、既存Cloudflare家計簿へ接続する。家計データは既存D1に保存する。
Sitesが付与する本人情報から短命の署名JWTを生成し、家計簿は公開鍵と現在の家族・管理者設定で認可する。
家計簿のWeb画面へ同じメールで一度ログインした利用者だけが使える。

`corepack pnpm build:connection`でバックエンドのツール定義からカタログを生成し、サーバーをバンドルする。
Sitesへの公開ソースと成果物は、この出力を使って組み立てる。MCP宣言入りZIPのインポートは使わない。

ランタイム設定:

- `KAKEIBO_SITE_ORIGIN`: Sitesが返した正確な公開オリジン。
- `KAKEIBO_MCP_URL`: 既存家計簿のHTTPS MCP URL。
- `KAKEIBO_SIGNING_PRIVATE_JWK`: ES256の秘密鍵。Sitesのホスト用Secretへ登録する。

Workerには対応する`SITES_TOKEN_ISSUER`と`SITES_TOKEN_PUBLIC_JWK`を設定する。
鍵の失効・回転時は双方の設定を更新する。秘密鍵はソース・設定ファイル・成果物に保存しない。

## 共有と受入

所有者限定で公開し、生成されたプラグインをインストールする。スマホで`getTaxonomy`を実行してから、テスト分類と資産の管理、下書き取り込み、Webでの訂正確定、集計を確認する。
家族への共有はSiteとプラグインの両方で行い、家計簿の利用者リストにも追加する。
