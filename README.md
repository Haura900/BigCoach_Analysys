# BigCoach Tools

このリポジトリには、GitHub Pagesで動く **BigCoach Luck Analyzer** と、Windows向け **BigCoach Anki Studio** が含まれます。

## BigCoach Luck Analyzer

`docs/` はビルド不要の完全静的アプリです。BigCoachの解析JSONから、次のTier 1指標だけを評価します。

- 配牌運: 各局の初回意思決定時点の和了確率を、ブラウザ内に蓄積した経験分布と比較し、percentile / σ相当で表示
- リーチ後和了運: リーチ時の予測和了確率 `p` と実績 `Y` から `Σ(Y-p) / sqrt(Σp(1-p))`
- 放銃運: 各打牌の予測放銃率 `p` と実績 `Y` から同じ式（プラスほど予測以上に放銃しており不運）
- 打点運: JSONに期待打点がある和了について、実績点との差を表示

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

URLだけを指定した必ず成功する取り込みや、ログインCookieの共有は、バックエンドを持たないGitHub Pagesでは実現できません。直接取得に失敗した場合、アプリは代替導線へ自動で切り替えます。

### 取得項目と評価の限界

- `sl_outcome` の先頭2要素を和了確率として使用します。
- 配牌運は厳密な13枚配牌時ではなく、BigCoach JSONで得られる「各局の最初の意思決定時点」の代理評価です。
- 放銃実績は、放銃局の最後の評価可能な自家打牌に割り当てます。
- 打点実績はBigCoachの `end_status.deltas` にある自家増分、期待打点は `expected_win_points` を使用します。供託・本場などの影響を含む場合があります。
- 実際に乗った裏ドラ枚数や一発がJSONに明示される形式だけ対応します。`ura_markers` は表示牌であり実枚数ではないため代用せず、取得できない場合はUIに「未対応」と表示します。
- 経験分布はこのブラウザに保存したデータだけです。母集団統計ではなく、自分の履歴内での相対比較です。局数が増えるほど分布の粒度が上がります。

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
