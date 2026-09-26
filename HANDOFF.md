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
* 2D の寸法・注釈（頂点名・辺の長さ／寸法線・内角）を追加（#4）。既定は非表示。
  3D の注釈は未対応。
* テスト: `npm test`（単体 118件）、`npm run test:e2e`（ブラウザ 19項目）。
  GitHub Actions（`.github/workflows/test.yml`）で push / PR ごとに実行。

## 経緯

| PR / コミット | 内容 |
|---|---|
| #1 | v1 実装（マージ済み） |
| `a2249b2`（main 直接） | Pages の初回ビルドが走らなかったため、README 変更で再トリガー |
| #2 | v1 レビューで見つかった不具合の修正（下記）。マージ済み、CI（unit / browser）緑 |
| #3 | この HANDOFF.md の追加（マージ済み） |
| #4 | 2D の寸法・注釈（`js/annotations.js`）。下記 |

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

#4（寸法・注釈 2D）の設計判断。HANDOFF の想定設計（純粋関数の
`annotations.js` → scene に text / line item → `render-svg` で描画、座標は
`computeFit(...).map`）どおりだが、次の点を追加・変更した:

* **`computeFit` に辺ごとの追加余白 `pad` を追加**。ラベルは px 固定サイズなので
  論理座標の bbox に含められない。`buildScene2D` が「フィット → 配置 →
  はみ出し測定 → pad 拡大」を収束まで繰り返す。pad なしの式は従来と同一で、
  注釈オフ時の出力は従来とバイト単位で同じ（テストあり）。
* **ラベル同士・辺との衝突回避**を入れた（想定設計には無かった）。解析的な
  初期位置から外向きに 1px ずつずらす単純な方式。細い三角形などで
  ラベルが重なったため。角度ラベルは図の内側に限定（辺をまたぐと別の角の値に
  見えるため）し、入らなければ頂点の外側に出す。
* **文字幅は DOM で測らず概算**（文字種ごとの em 幅）。Node で決定的にテスト
  できるようにするため。e2e で実測（`getBBox`）が見積もり以内であることを確認。
* **`text` item は (x, ベースライン y) で持つ**。`dominant-baseline` は SVG を
  `<img>` 経由で描く際の互換性が不安なので使わない。
* PNG の文字確認（e2e）は、エクスポート経路で PNG 化した画像と、同じ文字列を
  Canvas の `fillText` で同じフォントで描いた参照画像の、文字枠内の濃い画素の
  IoU（> 0.8、実測 ≈ 0.97）と、文字の有無でのインク量で判定している。

## 開発の進め方

```
npm test                                   # 依存なし、数秒
npm install && npx playwright install chromium
npm run test:e2e                           # ブラウザテスト
CHROMIUM_PATH=/path/to/chromium npm run test:e2e   # 既存の Chromium を使う場合
                                           # クラウドセッションでは /opt/pw-browsers/chromium
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

1. **3D の寸法・注釈**: 可視の辺にだけ長さ（寸法線）を付ける、頂点名など。
   * 可視判定は `hidden-line.js` の `classifyEdges`（多面体）がそのまま使える。
     ラベルの外向き方向は「投影後の凸包の外側」（`convexHull`）で決められる。
   * 3D は同じ長さの辺が多いので、全辺ではなく「幅・高さ・奥行きを1本ずつ」
     付けるモードが教材では自然。円柱・円錐は半径（直径）と高さ。
   * `annotations.js` の `Placer`（衝突回避）と `placeInWedge`、
     `computeFit` の `pad` ループ（`buildScene2D` 内）は流用できる。
     ループを 3D 側でも使うなら関数に切り出すこと。
2. **2D 注釈の拡張**: 直角記号（90° の角を弧でなく四角で）・等長記号、
   頂点名の任意指定、辺ごと/角ごとの表示選択。直角記号は `annotate2D` の
   弧を描く箇所で `interiorDeg ≈ 90` のとき分岐すれば足りる。
3. **形状の向きのバリエーション**: 横倒しの円柱、三角形の面を手前にした
   三角柱（教科書で多い描き方）など。現状は円柱・円錐の軸が Y 軸固定。
   `geometry3d.js` の `axis` と `curved-solids.js` はすでに任意の軸に対応した
   式になっているので、主に形状生成と UI の追加で済む見込み。
4. **設定の共有**: 入力値を URL クエリに保存し、同じ図を再生成できるようにする。

## 設計上の決定事項（変更する場合は理由を記録すること）

* 描画の正本は SVG。PNG は SVG → Canvas → `toBlob()`。
* 投影はすべて線形写像（2×3 行列）で表す。これを崩すと楕円・輪郭線・
  視線方向の計算前提が崩れる。
* 斜投影系は「x-y 平面が実長で手前」、視聴者は −z 側という慣習。
* 画像サイズは図形の縦横比＋余白（長辺 800 が 1x）。
* 許容誤差はスケール相対（`EPSILON = 1e-6` × 周長 / 最長辺）。
* 注釈の文字はシステムフォントのみ（`render-svg.js` の `FONT_FAMILY`）。外部 Web
  フォントは使わない（SVG を `<img>` で描くと読み込まれず、Canvas を taint しうる）。
* 注釈がすべてオフのときの出力は、注釈機能追加前と同一に保つ。
