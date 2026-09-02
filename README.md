# BigCoach Anki Studio

BigCoachの解析結果から、何切るシミュレーションとAnkiカード登録を行うWindows向けElectronアプリです。

Luck Analyzerは別リポジトリへ移動しました。

- アプリ: <https://haura900.github.io/BigCoach_Luck_Analyzer/>
- リポジトリ: <https://github.com/Haura900/BigCoach_Luck_Analyzer>

旧Pagesに保存されていたLuck Analyzerの履歴は、<https://haura900.github.io/BigCoach_Analysys/> の移行ページからJSONとして退避できます。

## 開発

Electronアプリは `src/`、同梱シミュレーターは `resources/simulator/` にあります。

```powershell
npm install
npm test
npm run start
npm run dist
```

## Simulator engine

The bundled simulator is pinned by `engine-lock.json` to a tagged release of `Haura900/mahjong-cpp`. Run `npm run engine:update` to download and verify that exact Windows artifact. Engine updates are intentional: update the lock file, run the tests and smoke test, then build the installer.

Anki登録にはAnkiとAnkiConnect（code `2055492159`）が必要です。BigCoachのログイン状態はElectronの永続セッションに保存されます。
