# らくがきブロック v20.142 — Render公開手順

このZIPは、Node.js + WebSocketサーバーを Render の Web Service として公開するための設定を追加したものです。ゲーム本体は `index.html`、`game.js`、`phone-game.js` などを同じフォルダに置く従来構成です。

## Render に公開する

> ビルド失敗時の注意：Render のログが `npm ci` と表示され、`package-lock.json` がないというエラーになる場合、Render が読んでいるリポジトリ／Root Directory に `package-lock.json` が含まれていません。この版では `render.yaml` のビルドコマンドを `npm install --no-audit --no-fund` にしています。既存サービスの設定が引き続き `npm ci` の場合は、Render Dashboard の **Settings → Build & Deploy → Build Command** も同じコマンドに変更してください。`package.json`、`package-lock.json`、`render.yaml`、`server.js`、`index.html` が同じリポジトリルートにあることも確認してください。

## Render に公開する

1. ZIPを展開します。
2. 展開したフォルダの中身を、GitHub の新しいリポジトリのルートへアップロードします。`render.yaml` と `package.json` がルート直下にあることを確認してください。
3. Render Dashboard で **New + → Blueprint** を選び、そのGitHubリポジトリを接続します。Render はルートの `render.yaml` を読み、Web Service を作成します。
4. 初回作成時に `ADMIN_PASSWORD` を求められたら、推測されにくい独自の値を設定してください。これは管理者用の合言葉であり、プレイヤーの入場パスワードとは別です。ソースコードやGitHubに実際の秘密を保存しないでください。
5. デプロイが `Live` になったら、Renderが表示する `https://...onrender.com` のURLを開きます。HTTPSからはクライアントが自動で `wss://` を使用するため、通常はWebSocket URLを手動設定する必要はありません。
6. `/health` を開き、`{"ok":true,...}` が返ればHTTPサーバーは応答しています。ゲームに実際に参加して、WebSocket接続も確認してください。

## 公開範囲と管理者設定

- URLを知っている人は参加できる公開設定です。特定の人に限定したい場合は、Renderの Environment に `JOIN_PASSWORD` を追加して入場パスワードを設定してください。
- `ADMIN_PASSWORD` は管理者機能の認証用です。強い独自の値を使ってください。
- `TRUST_PROXY=1` は Render のプロキシ経由で接続元IPを扱う設定です。
- `start.bat` はローカルWindows用です。Renderでは使用せず、Renderの `npm start` を使います。

## ワールド保存についての重要な注意

標準設定は無料プランで試せるようになっていますが、RenderのFree Web Serviceではローカルファイルシステムが永続化されません。再デプロイ・再起動・スピンダウン時に `snapshots/` の保存内容が失われる可能性があり、ワールドの変更を長期間保存する用途には適しません。Render Freeサービスは、一定時間受信トラフィックがないと休止する仕様もあります。

**ワールドを再起動後も保存したい場合**は、Renderの有料Web Serviceに Persistent Disk を追加してください。ディスクの Mount Path を `/var/data` にし、Environment に `SNAPSHOT_DIR=/var/data/snapshots` を追加します。サーバーはこの環境変数で保存先を切り替えます。永続ディスクは無料インスタンスでは利用できません。作成前にRenderの料金を確認してください。

## ローカルでのテスト

1. Node.js をインストールします。
2. フォルダで `npm ci` を実行します。
3. 必要なら `.env.example` を `.env` にコピーし、合言葉を変更します。
4. `npm start` またはWindowsなら `start.bat` で起動します。通常は `http://localhost:3040/` を開きます。

## 今回のRender対応

- Renderの `PORT` 環境変数を使う既存実装を維持。
- Render Blueprintの `render.yaml` を追加（`npm install --no-audit --no-fund` / `npm start` / `/health`）。
- WebSocketはゲームと同じオリジンを自動利用。公開HTTPSでは `wss://` になります。
- `SNAPSHOT_DIR` 環境変数を追加し、有料プランの永続ディスクへスナップショットを保存可能に。
- ローカル起動バッチに入っていた固定管理者パスワードを削除。GitHubに秘密を誤公開しにくくしました。

## 検証上の制限

ZIP整合性とJavaScript構文の確認は行いますが、この作業環境からユーザーのRenderアカウントへデプロイすることはできません。デプロイ後、ブラウザ接続・複数参加者の同期を実環境で確認してください。


### v20.140 の変更
ペン選択中の右手保持モデル、一人称用の手持ちペン表示、他参加者への装備状態同期を追加しました。


### v20.141 の更新
下層洞窟を追加しました。既存の Render サービスは GitHub へ更新を push して再デプロイしてください。保存ワールドの洞窟予定地が編集済みの場合、データ保護のため下層の導入を自動で見送ります。


### v20.142 の変更
- 自然テーマの洞窟へ水たまり、水滴、湿った岩肌、小さな落石、鍾乳石、非敵対のコウモリを追加。演出はクライアント側で描画し、既存のワールドブロックや当たり判定は変更しません。
- クライアント・サーバーのプロトコル番号を 16 に揃えました。
