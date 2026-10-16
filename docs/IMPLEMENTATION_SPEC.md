# 実装仕様と配置方針

## 配置先

推奨ルート：`C:\Users\はると\Documents\Codex\nw-afternoon-flashcards`

引継ぎZIPにはdata・config・docsとプロンプトを同梱する。次のsrc・public・scripts・tests等は実装担当が作る予定構成であり、今回作成済みのアプリコードではない。既存アプリへ組み込む場合は、そのディレクトリ規約へ読み替える。

```text
nw-afternoon-flashcards/
├─ START_HERE.md
├─ CODEX_IMPLEMENTATION_PROMPT.md
├─ README.md                         # 実装担当が作成
├─ package.json                      # 実装担当が作成
├─ package-lock.json                 # npmを選んだ場合
├─ index.html
├─ vite.config.ts
├─ tsconfig.json
├─ data/
│  └─ source/                        # 同梱。研究原本を保持
│     ├─ dataset_manifest.json
│     ├─ knowledge_atoms.json
│     ├─ question_pool.json
│     ├─ taxonomy.json
│     └─ first_100_atom_ids.json
├─ config/
│  └─ learning_profiles.json         # 同梱。初期学習分野を定義
├─ docs/
│  ├─ IMPLEMENTATION_SPEC.md
│  ├─ DATA_CONTRACT.md
│  ├─ research/                      # 同梱。調査レポート・監査資料
│  └─ reference/original_app_request.txt
├─ scripts/
│  ├─ validate-data.ts               # ID・件数・参照・設定検証
│  └─ build-study-data.ts            # 必要なら配信用データを生成
├─ public/
│  └─ study-data/                    # fetch配信方式の場合の生成先
├─ src/
│  ├─ app/App.tsx
│  ├─ pages/                        # Home・Study・Hidden・Settings・Result
│  ├─ components/                   # QuestionCard・SourceList等
│  ├─ domain/                       # 型・選問・セッション・適格性判定
│  ├─ data/                         # ローダー・検証・原子との結合
│  ├─ storage/                      # ローカル保存の実装とインターフェース
│  ├─ hooks/
│  └─ styles/
└─ tests/                           # 選問・保存・主要画面の検証
```

`data/source`と`docs/research`はpublic配下へそのままコピーしない。配信用データを生成する場合は原本を入力にし、`public/study-data`を自動生成物とする。JSONをsrcへ静的importする方式でもよい。どちらかに統一し、複数の手編集した問題バンクを作らない。

研究用の `question_analysis.json` 約3MBは監査用であり、通常の学習画面では不要。問題が持たない情報は原子IDで結合する。原本に重複している出典等を配信用に圧縮・共有化する場合は、表示に必要な情報とID・確認状態・注記を保持し、生成前後の参照整合を検証する。

## 画面構成

| 画面 | 主な内容 |
| --- | --- |
| 開始 | 分野指定／全分野ランダム、5/10/20問、候補数、推奨100プリセット |
| 学習 | 進捗、カード表裏、非表示、次へ、中断して戻る |
| 終了 | 次へ進んだ数・非表示数、同条件で再開、条件変更 |
| 非表示一覧 | 問題文・所属分野、個別復活。非表示0件の表示 |
| 設定 | 学習分野、未確認補充OFF/ON、状態のエクスポート／インポート |

画面は独立URLでも画面内切替でもよい。画面数を増やすための画面は作らない。出典の詳細はカード内で展開できるようにする。

## 出題候補とセッション

適格性の判定を共通関数へまとめ、開始画面の候補数・実際の選問・復活後の表示で同じ判定を使う。

通常の条件：

1. 問題と対応原子の検証に成功している。
2. 問題 `defaultEnabled=true` かつ原子 `verified=true`。
3. 原子の学習グループが利用者の設定で有効。
4. 分野指定や推奨100など、その開始条件に一致。
5. 問題IDに対応するユーザー状態がhiddenでない。

未確認補充ONでは「未確認として登録された補充問題」のみ2の例外を認める。一般的なdefaultEnabled=falseを一律に有効化しない。除外された不成立設問を復活させない。

開始時に問題IDのキューを一度決め、通常の再描画では再抽選しない。抽選は非復元。同じ原子の別カードは、他原子が十分なら同セッションで重ねない。不足時は別カードで補えるが、同じ問題IDは重複させない。

非表示にした現在問は直ちに次へ進む。非表示を学習済み・正解とは数えない。固定キュー内で除外した分は「非表示」として別表示し、当初の5問を終えると「学習4・非表示1」のように結果を示せる。非表示後に無関係な分野から補充しない。

0問のときは開始を禁止し、「分野を追加する」「非表示一覧へ」「未確認補充の説明を見る」等、原因に合う操作を案内する。

## ユーザー状態

教材ファイルとユーザー状態は別。初期版の保存先はlocalStorageを基本とし、インターフェースを介して将来IndexedDB・クラウド同期へ置き換えられるようにする。

```json
{
  "schemaVersion": 1,
  "datasetVersion": "ipa-nw-2009-2025-v2-20261016",
  "settings": {
    "enabledGroupIds": ["switching", "routing"],
    "allowUnverifiedSupplement": false,
    "questionCount": 10
  },
  "questionStates": {
    "Q_TLS_KEY_L1": { "hidden": true }
  }
}
```

上のenabledGroupIdsは形式例で、初期値は必ずプロフィールのdefaultEnabledGroupIdsから取得する。存在しない状態の問題はhidden=falseとみなす。名前空間の例は `nw-afternoon:user-state:v1`。全件状態を毎回教材へ付加して書き戻さない。

将来のlastReviewed、confidence、correctCount、incorrectCount、nextReview、favorite、note等は問題ID別の状態を拡張して追加可能にする。現時点の未入力を勝手に「正解」「習得済み」として埋めない。アプリに未実装の機能の保存項目があっても、UIで実装済みと表示しない。

更新ではdatasetVersionとストレージのschemaVersionを分ける。教材の版変更だけで全学習履歴を初期化しない。インポートは検証後に件数・競合方針を示して適用する。未確認補充を勝手にONにするインポートは避ける。

## 実装順と受入条件

1. 原本の読込みと検証。配信用データ・型・プロフィールを接続。
2. 適格性判定・選問・セッション・状態保存を実装。
3. 開始→カード→終了、非表示→復活、設定を接続。
4. モバイル表示・保存失敗・空データ・リンクを検証。
5. README、データ更新方法、将来拡張を記録。PWAは追加実装した範囲だけ検証。

| 検証 | 期待結果 |
| --- | --- |
| 新規状態 | 通常有効836問、初期プロフィールの候補659問、未確認16問は非出題 |
| 分野OFF | 全分野ランダムでもその分野は出ない |
| 未確認OFF | 選択分野内でも未確認カードは出ない |
| 分野指定 | 異なる分野から不足分を黙って補充しない |
| 5/10/20問 | 可能な数を非復元抽選し、ID重複なし |
| 候補不足／0件 | 実数と理由を表示、無限ループや空カードなし |
| 非表示 | 即時除外、再読込み後も除外、同原子の別問題は残る |
| 復活 | 現在の学習分野・確認設定を守って対象へ戻る |
| 解答表示 | 次へ進むと表面へ戻る |
| 結果 | 学習数・非表示数を区別、正答率は表示しない |
| 出典 | 複数参照・本文のページ・未確認・注記を正しく表示 |
| 保存破損／容量超過 | クラッシュせず通知、元状態を無断消去しない |
| 状態移行 | エクスポート→別状態へインポートで非表示・分野が復元 |
| 狭い画面 | 320/375/430pxで主要操作が可能、本文が全体横あふれしない |
| データ保護 | 原本4JSONのSHA-256がdataset_manifestと一致 |

選問・設定・保存のテストは意味のある境界条件を中心にする。ボタンの見た目だけの大量テストは不要。ブラウザーで「開始→解答→非表示→再読込→復活」の一連の動作を確認する。

## 技術選定の参照先

空のプロジェクトの候補としてReact・TypeScript・Viteを想定した。実装時には公式ドキュメントで依存版と実行環境を確認する。

- [Vite公式 Getting Started](https://vite.dev/guide/)
- [React公式 Build a React app from Scratch](https://react.dev/learn/build-a-react-app-from-scratch)

## Phase 2以降

理解度3ボタン→履歴→苦手優先→間隔反復の順で拡張できる。時間指定では時間切れ時に現在問をどう終えるかを追加仕様として決める。ログイン・同期ではローカル状態の移行と競合解決が必要となるため、初期版の隠れた必須機能にしない。
