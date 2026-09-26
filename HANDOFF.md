# HANDOFF（開発引き継ぎメモ）

次の開発者（または次のタスク/セッション）がこのファイルだけ読めば作業を
再開できることを目的とした記録です。仕様は [REQUIREMENTS.md](./REQUIREMENTS.md)、
設計・数式は [ARCHITECTURE.md](./ARCHITECTURE.md)、使い方は
[README.md](./README.md) を参照してください。

最終更新: 2026-09-26

## 現在の状態

* 公開: https://edi-tool.github.io/zukei-drafter/
  （GitHub Pages、`main` ブランチの `/`(root) を配信。`.nojekyll` あり）
* v1 の機能はすべて実装済み（2D: 正多角形・三角形 SSS/SAS/ASA・一般多角形、
  3D: 8形状 × 4投影法、隠線、PNG/SVG保存）。
* テスト: `npm test`（単体 79件）、`npm run test:e2e`（ブラウザ 16項目）。
  GitHub Actions（`.github/workflows/test.yml`）で push / PR ごとに実行。

## 経緯

| PR / コミット | 内容 |
|---|---|
| #1 | v1 実装（マージ済み） |
| `a2249b2`（main 直接） | Pages の初回ビルドが走らなかったため、README 変更で再トリガー |
| #2 | v1 レビューで見つかった不具合の修正（下記）。マージ後にこの表を更新すること |

#2 で修正した主な不具合（再発防止のため記録）:

* 三角柱・角錐の面の巻き順が内向きで、隠線が可視/不可視逆転していた。
  → `tests/geometry3d.test.mjs` が全多面体の外向き法線を検証している。
* 斜投影系の視線方向が `(0,0,1)` と誤っていた（立方体の隠線が8本）。
  → 視線方向は投影行列の零空間から求める。`tests/projections.test.mjs`
  と `tests/hidden-line.test.mjs` で検証。
* CSS の `display:flex` が `[hidden]` を上書きし、2D の入力欄が全部表示されていた。
  → `css/style.css` 冒頭の `[hidden] { display: none !important; }` を消さないこと。
* 空欄入力で NaN 座標が描画されコンソールエラーになっていた。
  → 入力検証は `js/app.js`、計算関数は不正値で `{ ok: false, reason }` を返す。

## 開発の進め方

```
npm test                                   # 依存なし、数秒
npm install && npx playwright install chromium
npm run test:e2e                           # ブラウザテスト
CHROMIUM_PATH=/path/to/chromium npm run test:e2e   # 既存の Chromium を使う場合
```

* 本番コードは依存ゼロ・ビルドなしを維持する（Playwright は devDependency のみ）。
* 計算は DOM に依存しない純粋関数に置き、`app.js` は入力の読み取り・検証と
  配線だけにする。新しい計算には必ず単体テストを付ける。
* 見た目の確認は、`buildScene3D` の結果を並べた HTML を Playwright で
  スクリーンショットすると早い（全形状×全投影を1枚で確認できる）。
* PR を作るたびに CI（unit / browser）が緑であることを確認する。

### 作業環境での注意（クラウドセッションで遭遇したもの）

* `edi-tool.github.io` と `api.github.com` への直接アクセスは egress プロキシで
  ブロックされる。公開サイトの確認はユーザーに依頼し、GitHub の状態確認は
  GitHub MCP ツールを使う。
* `pkill -f "<パターン>"` は同じ文字列を含む自分自身のシェルも殺すことがある。
  その後に続くコマンド（`git stash pop` など）が実行されないので、
  後処理は別コマンドに分ける。
* GitHub Pages は設定保存直後に初回ビルドが走らないことがあった。
  その場合は `main` への push で再トリガーできる（Actions の
  "pages build and deployment" で確認）。

## 次にやること（優先度順の候補）

1. **PR #2 のレビュー・マージ**（CI 緑を確認済みであれば、ユーザーの判断でマージ）。
2. **寸法・注釈（仕様上の将来拡張）**: 辺の長さ、角度、頂点名、寸法線。
   * 想定設計: `js/annotations.js`（純粋関数）で論理座標上に注釈を計算し、
     scene に `text` / 寸法線用 `line` の item を追加、`render-svg.js` に
     `text` 描画を追加する。論理座標→SVG座標は `computeFit(...).map` を使う。
   * 注意: 外部 Web フォントは Canvas を taint しうるので使わない
     （`font-family` はシステムフォントのみ）。PNG 化で文字化け・フォント差が
     出ないか e2e で確認する。
   * 2D は頂点・辺が揃っているので先に着手しやすい。3D は可視な辺だけに
     付けるなど隠線情報との連携が必要。
3. **形状の向きのバリエーション**: 横倒しの円柱、三角形の面を手前にした
   三角柱（教科書で多い描き方）など。現状は円柱・円錐の軸が Y 軸固定。
   `geometry3d.js` の `axis` と `curved-solids.js` はすでに任意の軸に対応した
   式になっているので、主に形状生成と UI の追加で済む見込み。
4. **2D の直角記号・等長記号**（教材でよく使う記号）。
5. **設定の共有**: 入力値を URL クエリに保存し、同じ図を再生成できるようにする。

## 設計上の決定事項（変更する場合は理由を記録すること）

* 描画の正本は SVG。PNG は SVG → Canvas → `toBlob()`。
* 投影はすべて線形写像（2×3 行列）で表す。これを崩すと楕円・輪郭線・
  視線方向の計算前提が崩れる。
* 斜投影系は「x-y 平面が実長で手前」、視聴者は −z 側という慣習。
* 画像サイズは図形の縦横比＋余白（長辺 800 が 1x）。
* 許容誤差はスケール相対（`EPSILON = 1e-6` × 周長 / 最長辺）。
