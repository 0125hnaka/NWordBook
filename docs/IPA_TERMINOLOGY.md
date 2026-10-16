# IPA試験資料に合わせた用語表記

確認日：2026-10-16。学習画面では、対応するIPAの問題冊子・解答例・シラバスで確認した表記を優先します。英語を独自に正答の主表記にすることは避け、確認した対応を `data/editorial/ipa_terminology.json` へ記録します。

| 旧表記の例 | 学習画面の表記 | 確認資料 |
| --- | --- | --- |
| Supplicant | サプリカント | [2017年度秋期 NW 午後Ⅱ 問2 設問5(1)](https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt8000000fqpm-att/2017h29a_nw_pm2_qs.pdf) |
| Authenticator | オーセンティケータ | [同年の採点講評](https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt8000000fqpm-att/2017h29a_nw_pm2_cmnt.pdf)でも確認 |
| Manager / Agent | マネージャ / エージェント | [2018年度秋期 NW 午後Ⅰ 解答例 PDF2ページ](https://www.ipa.go.jp/shiken/mondai-kaiotu/gmcbt8000000f01f-att/2018h30a_nw_pm1_ans.pdf) |
| Polling / Trap / Inform | ポーリング / トラップ / インフォーム | 同上、問2 設問4(2)〜(3) |
| Forward Proxy / Reverse Proxy | フォワードプロキシ / リバースプロキシ | [2025年度春期 NW 午後Ⅰ 問3](https://www.ipa.go.jp/shiken/mondai-kaiotu/nl10bi0000009lh8-att/2025r07h_nw_pm1_qs.pdf) |
| Server / Client / Protocol | サーバ / クライアント / プロトコル | [NWシラバスVer.4.1、2-2](https://www.ipa.go.jp/shiken/syllabus/nq6ept00000014fp-att/syllabus_nw_ver4_1.pdf) |
| Router ID | ルータID | [2024年度春期 NW 午後Ⅱ 問1 設問2(2)](https://www.ipa.go.jp/shiken/mondai-kaiotu/m42obm000000afqx-att/2024r06h_nw_pm2_qs.pdf) |
| Next hop | ネクストホップ | [2023年度春期 NW 午後Ⅱ 解答例 PDF2ページ](https://www.ipa.go.jp/shiken/mondai-kaiotu/ps6vr70000010d6y-att/2023r05h_nw_pm2_ans.pdf) |

表記確認用の出典と、各知識・短問の出典は役割が異なります。この表の資料を、元の問題の出典や出題頻度へ追加してはいません。表記統一はIPAが本アプリを監修したことを意味しません。

## 適用範囲

- 17種類の確認済み対応を、原本カードと追加用語カードの両方へ適用（セッションの表記も2023年度解答例で確認）。
- 問題文、解答、解説、回答対象、思考トリガー、間違えやすい点、学習分野名等の表示を統一。
- 追加した2方向の用語カードでは、質問も正答も「サプリカント」「オーセンティケータ」を主表記とする。
- 調査原本は変更せず、教材を読み込む際に表示用データだけを整える。
- 問題IDは維持するので、理解度・非表示の記録は引き継がれる。

## そのまま残す表記

HTTP、TLS、RADIUS、IEEE 802.1Xなどの規格名・略語は、その表記を維持します。`ClientHello`、`ServerHello`、`NEXT_HOP`、`AS_PATH`、`Set-Cookie`、`Proxy-Authenticate`など、メッセージ名・属性名・ヘッダー名も変更しません。URL、機器識別名、バッククォートで囲んだリテラルも保持します。

英語や長音を無条件に全置換することはしません。今後の追加・修正も、実際のIPA資料の表記を確認して用語表へ追加します。IPA資料の年度・文脈で表記が異なる場合は、対象の出典と識別子の意味を確認して判断します。
