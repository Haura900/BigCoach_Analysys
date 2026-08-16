# BigCoach Tools

このリポジトリには、GitHub Pagesで動く **BigCoach Luck Analyzer** と、Windows向け **BigCoach Anki Studio** が含まれます。

## BigCoach Luck Analyzer

`docs/` はビルド不要の完全静的アプリです。BigCoachを正解データとは置かず、次の8指標を2系統の方法で評価します。

経験分布で評価する指標:

- 配牌時和了率: 各局の初回意思決定時点にある `sl_outcome` の和了予測値そのものを経験分布で順位化。実際の和了結果は使わない
- 配牌時平着変動: `sl_placement` の加重平均順位と配牌前の現在順位との差を経験分布で順位化
- 放銃予実幅: 被リーチ・被2副露時だけを対象に、BigCoachの放銃予測率と実績の差を局単位の経験分布で順位化

残り牌から逐次理論値を計算する指標:

- ドラツモ率: 表ドラと赤ドラを対象に、全員の初期手牌・既出牌を除いた条件付き残り牌から計算
- 有効牌ツモ率: 通常形・七対子・国士の向聴数が小さくなる牌を各ツモ直前に再計算
- リーチ時自明和了率: 自分のツモ、および双方リーチ時の相手ツモ切りについて残り和了牌数から計算
- リーチ時危険牌率: 自分がリーチ中、テンパイ形の相手の待ちをつかむ率を計算。自分の和了牌は競合事象として除外
- 被リーチ時現物掴み率: 相手リーチ成立後に現物をツモる率。複数リーチ時は全リーチ者への共通現物だけを対象にする

総合運は相関の強い指標を「配牌・守備・通常ツモ・リーチ後」の4系統にまとめ、系統ごとの0–100値を平均した記述指数です。p値やσとしては扱いません。検定は別枠で表示します。

解析結果はブラウザの `localStorage` にだけ保存され、サーバーへ送信されません。牌譜単体と保存済み全牌譜の集計を切り替えられ、履歴はJSONとしてエクスポートできます。

### BigCoachデータの取り込み方法

1. **レビューURLから直接取得を試す**
   `https://gokujan.com/review/...` と `https://review.bigcoach.work/review/...` に対応しています。ただし、GitHub PagesからBigCoach APIへの直接 `fetch` は、BigCoach側のCORS設定やログイン状態によりブラウザに拒否されることがあります。静的サイトからこの制約を回避することはできません。
2. **ブックマークレット（推奨）**
   アプリ上の「Luck JSONをコピー」をブックマークバーへドラッグし、BigCoachのレビュー画面で実行します。同一オリジン上で解析JSONを取得し、クリップボードへコピーします。コピーできないブラウザではJSONをダウンロードします。
3. **JSON / HTML貼り付け**
   `review.kyokus` を含むBigCoach解析JSONを貼り付けます。ページHTML内にJSON本体が埋め込まれている場合も読み取ります。HTMLに期限付きJSON URLしかない場合はCORSを越えられないため、ブックマークレットを使ってください。
4. **JSON / HTMLファイル**
   保存したファイルを端末内で読み込みます。
5. **はうらCの履歴を差分取得**
   「はうらCの未取得実戦を保存」をブックマークバーへ登録し、ログイン済みBigCoachの `https://gokujan.com/account/history` で実行します。履歴APIの `category=real` と `reviewKind` で実戦だけに限定し、プレイヤー名が「はうらC」と一致する牌譜だけを対象にします。取得済みタスクIDはBigCoach側オリジンの `localStorage` に記録し、次回以降は未取得JSONだけを1つの差分バンドルとして保存します。取得失敗分は記録せず、次回に再試行します。雀魂などのプラットフォーム名が履歴メタデータにあれば、バンドルにも保存します。

URLだけを指定した必ず成功する取り込みや、ログインCookieの共有は、バックエンドを持たないGitHub Pagesでは実現できません。直接取得に失敗した場合、アプリは代替導線へ自動で切り替えます。

### 取得項目と評価の限界

- `sl_outcome` の先頭2要素を和了確率として使用します。
- 配牌運は厳密な13枚配牌時ではなく、BigCoach JSONで得られる「各局の最初の意思決定時点」の代理評価です。
- 放銃実績は、放銃局の最後の自家打牌に割り当てます。その打牌が被リーチ・被2副露条件を満たさない場合は対象外です。
- 経験分布はこのブラウザに保存したデータだけです。母集団統計ではなく、自分の履歴内での相対比較です。局数が増えるほど分布の粒度が上がります。
- 経験分布系は30局に達するまで参考表示だけとし、総合運には算入しません。
- 理論系は通常ツモ20回、リーチ関連と現物ツモ10回に達するまで総合運には算入しません。
- BigCoach JSONでは未配牌の生牌山と未公開の王牌を分離できません。理論確率の母集団は、全員の初期手牌・既出牌・公開ドラ表示牌を除いた「未割当牌」で、未公開の王牌を含みます。
- リーチ時危険牌は相手のテンパイ形を向聴数で判定します。相手の役有無とフリテンまでは判定しないため、「形上の当たり牌」です。
- 同一対局は `mjai_log`、`split_logs`、牌譜ID、または結果と実打列から生成した対局IDで判定し、重複登録を除外します。AIモデルや予測確率が異なっても、元牌譜が同じなら1対局として扱います。
- 適合度検定は逐次確率残差、席順と局間連続性は半荘内の置換検定を使います。主検定は「理論値系」「BigCoach依存系」「全指標統合」の3通りで、各系統内のp値をCauchy法で統合し、3主検定をHolm法で補正します。個別診断も別表でHolm補正後のp値を表示します。
- p値は牌操作がある確率ではありません。低い値が出た場合も、仕様差・選択バイアス・解析条件の事前固定を確認してから解釈します。

### ローカル確認

```powershell
python -m http.server 4173 --directory docs
```

`http://localhost:4173/` を開きます。計算ロジックを含む全テストは `npm test` で実行できます。

## BigCoach Anki Studio

Electronアプリは `src/`、同梱シミュレーターは `resources/simulator/` にあります。

```powershell
npm install
npm test
npm run start
npm run dist
```

### Simulator engine

The bundled simulator is pinned by `engine-lock.json` to a tagged release of `Haura900/mahjong-cpp`. Run `npm run engine:update` to download and verify that exact Windows artifact. Engine updates are intentional: update the lock file, run the tests and smoke test, then build the installer.

Anki登録にはAnkiとAnkiConnect（code `2055492159`）が必要です。BigCoachのログイン状態はElectronの永続セッションに保存されます。
