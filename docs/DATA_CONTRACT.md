# 調査データとアプリの接続契約

## 入力と正本

教材の正本はdata/sourceのJSON。全てUTF-8で、knowledge_atoms、question_pool、taxonomy、first_100_atom_idsのルートは配列。実レコードを読んでから型を定義する。元の参考プロンプトのJSON例を実データのスキーマと思い込まない。

| 教材 | 基準 |
| --- | --- |
| knowledge_atoms.json | 366原子、うちverified=trueが358 |
| question_pool.json | 852問、うちdefaultEnabled=trueが836 |
| first_100_atom_ids.json | 重複しない確認済みAランク100原子ID |
| taxonomy.json | 技術別の分類枠。利用者の習得状態ではない |
| dataset_manifest.json | データ版、件数、原本4ファイルのSHA-256 |
| config/learning_profiles.json | 18学習グループ。11グループを初期ON、7グループは初期OFF |

初期プロフィールの通常出題候補659問は、問題・原子の確認状態と有効グループから算出する。個人の非表示・開始条件が加われば変化する。基準値は回帰チェックで使い、実行時の候補数の固定値にはしない。

## 結合と表示

`Question.knowledgeAtomId → KnowledgeAtom.id` を結合する。問題IDはカード単位、原子IDは知識単位。年度や配列の位置をキーにしない。

| 画面項目 | 参照元 |
| --- | --- |
| 問題・解答・解説・所要目安 | question、answer、explanation、estimatedSeconds |
| 難易度 | 問題difficulty（1～3） |
| 5段階 | 問題level（1～5）。全原子が5段階を持つわけではない |
| 出題形式 | questionType：term/mechanism/case/change/failure |
| 役割問題 | 主にlevel=2。questionTypeにroleという未定義値を追加しない |
| サブカテゴリ・用語・罠・仕組み | 結合した原子のsubcategory、term、commonTrap、mechanism |
| 初期学習分野 | プロフィール内のknowledgeAtomIdsからグループを得る |
| 重要度 | importance。3=★★★、2=★★、1=★ |
| 優先度 | priority。A/B/C。頻度だけで再判定しない |
| K/R/KR | 問題classificationと出典側classificationの意味を区別 |
| 出典 | 問題sourceRefsの配列。原子の出典へ勝手に単一化しない |
| 頻度 | 原子frequencyとfrequencySessions |
| 非表示 | ユーザー状態questionStates[question.id].hidden |

categoryはWeb、L3、その他など研究上の大分類である。アプリの選択肢をcategoryだけから作ると、利用者が未学習の詳細Mail等を混ぜるため、learning_profilesを使う。原本のcategoryを見栄えのため書き換えない。

## 出典の3ケース

1. **独立設問等から確認**：verified=true、subQuestionあり。年・試験回・午後区分・問・設問と各URLを表示。
2. **本文・関連前提**：verified=trueでもcountedForFrequency=falseの場合がある。relationshipとnoteを表示できるようにする。subQuestion=nullならproblemPdfPagesを使い、「本文・PDF○ページ」と表示。
3. **対応未確認**：verified=false、year等はnull。「IPA設問対応未確認」とし、空の年度や推測した番号、公式らしい架空リンクを表示しない。

officialProblemUrl、officialAnswerUrl、officialCommentaryUrlは別フィールド。公式解答PDFに出題趣旨が含まれる。公式のページ番号は配列に記録されたPDF先頭からの1始まりである。

出典の重複整理はyear/session/section/questionNo/subQuestion/relationship/URL/ページ等の意味を保持して行う。同じ大問でも違う設問・違う関係をまとめて消さない。外部リンクはhttp/httpsを検査し、任意の文字列をHTMLとして埋め込まない。

短問はorigin=authored_generalization、isOriginalIpaQuestion=false。出典との対応確認は、IPAが本アプリの独自短問を出題・監修したという意味ではない。

## 頻度

- subQuestionCount：同じ規則が必要な原設問キー数。
- majorQuestionCount：年・試験回・午後区分・大問で重複排除した数。
- examSessionCount：年・試験回で重複排除した数。午後IとIIへ出ても同一回なら1。

未確認補充、本文登場だけの前提、関連規則、派生したカード数は出題回数に加えない。頻度0と未確認は同義ではない。アプリの閲覧数・復習数とも分ける。

## 検証と追加

ID重複、参照先原子の不在、空のquestion/answer、未定義のpriority・questionType・classification、グループ内の重複や不明ID、グループ未割当て、推奨100の参照切れを検出する。

同梱プロフィールは全366原子を一つの主グループへ割当て済み。利用者が作る複数の横断プリセットでは重複してもよいが、選問時は問題IDで集合化する。新しい原子を追加したらグループ割当ても更新する。未知の分野を自動で通常出題へ含めない。

更新時は研究原本を正しい版で置き換え、プロフィールとデータ版・ハッシュ・件数を更新し、配信用データを再生成する。問題IDが同じならユーザーの非表示状態を引き継ぐ。既存の問題を別の知識へ置き換えるときは同じIDを再利用しない。

今回実装の対象には問題追加・修正を含めない。参考プロンプトで挙げた用語が同梱データにない場合も、その場で確認済み問題として追加せず、追加候補として報告する。
