# 学習画面内のAI質問機能を使うための準備

ユーザーの希望は「外部のChatGPTを開く方式」ではなく、解いている問題について入力し、アプリ内でAIの回答を読む方式。この機能はまだ接続・公開していない。今回公開した変更は条件に応じた問題数の表示。

## 構成案

既存のGitHub Pagesで問題を表示し、質問時だけ、本人用に認証したCloudflare WorkersのAPIへアクセスする。WorkerがOpenAI APIへ問い合わせ、回答を学習画面へ返す。通常教材と予想教材の両方に対応し、質問には現在表示している問題のID・問題文・解答・解説・技術根拠を添える。前の問題を見直しているときも、実際に表示中の問題を対象にする。

APIキーはWorkerのSecretに保管する。公開JavaScript、ブラウザーの保存領域、GitHubリポジトリには含めない。GitHub ActionsのSecretをビルドでJavaScriptへ埋め込む方法も使わない。これはOpenAIがAPIキーをサーバー側に保管するよう求めているため。

## まずユーザーが準備すること

1. [OpenAI Platform](https://platform.openai.com/)へログインし、API用のプロジェクトを用意する。請求・残高・利用可能なモデルを確認し、必要な場合は自分で支払設定を行う。費用は利用するモデル・送受信量に応じるため、予算と利用量の通知も決める。現時点ではモデルや有料プランを固定しない。
2. [Cloudflare](https://dash.cloudflare.com/)のアカウントを用意し、Workersを利用できる状態にする。個人用の小規模APIはWorkers Freeを構成候補にするが、無料枠には制限があり、OpenAI APIの費用はこの無料枠に含まれない。有料プランへの切替は不要な段階では行わない。
3. 上記の準備ができたことと、ひと月に許容するAI利用の予算を伝える。APIキーやパスワードはチャットへ貼らない。既に使っているAPIサーバーがある場合は、その方式に合わせることもできる。

## その後に実装・設定すること

1. 本人だけが呼び出せる認証、回数・入力長・回答長の制限を備えたWorkerを作る。送信元サイトの制限だけを認証の代わりにしない。
2. Workerを作成した後、ユーザーがCloudflareのWorker設定のSecretへOPENAI_API_KEYを登録する。画面にキーが表示される操作はユーザー自身で行う。本人用の認証情報もAPIキーとは別に設定する。
3. 学習画面に折り畳みの質問欄を追加する。質問文は問題IDごとに保持し、送信先・回答の出所を示す。送信・回答待ち・失敗・再試行を表示し、学習の進捗と理解度は維持する。
4. 通常問題・予想問題・過去の問題の見直し中に、実際のAPIで回答を取得する。認証なしの呼出し拒否、費用制限、エラー時に入力が消えないことも確認する。
5. 新たなAPIの公開先をユーザーに示して承認を受け、既存Pagesへ接続する。既存サイトの通常更新は継続承認済みだが、新しい公開先の追加はAGENTS.mdに従って別途確認する。

このチャットの会話や私の過去の記憶が、公開アプリへ自動でつながるわけではない。問題の文脈を添えてAIへ問い合わせる専用の処理として実装する。

## ChatGPTプランを利用する別方式について

OpenAIは「Sign in with ChatGPT」によるプラン利用の連携も案内している。対象アプリ・権限・利用条件があり、このGitHub Pagesの公開Webアプリで利用できることは未確認。ChatGPTの契約だけでこのアプリに自動接続できるとは案内しない。上記はOpenAI API方式を選ぶ場合の準備。

## 確認した公式資料

- [OpenAI APIの認証とキー管理](https://developers.openai.com/api/reference/overview)
- [OpenAI API料金](https://developers.openai.com/api/docs/pricing)
- [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart)
- [Cloudflare Workers料金](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
