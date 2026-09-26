# ARCHITECTURE

## 全体像

依存ライブラリなしの静的サイト。責務ごとにモジュールを分割し、
`<script type="module">` で読み込む（ビルド不要、GitHub Pagesにそのまま
配置可能。`.nojekyll` によりJekyll処理を経ずファイルをそのまま配信）。

```
index.html             エントリーポイント / DOM構造
css/style.css          レイアウト・見た目
js/geometry2d.js       2D幾何計算（座標のみを返す）
js/geometry3d.js       3D形状データ生成（頂点・辺・面、円柱/円錐の解析的表現）
js/projections.js      3D→2D投影（線形写像）と、その正確な投影方向（視線）
js/hidden-line.js      多面体の可視/不可視エッジ判定
js/ellipse.js          円の投影＝パラメトリック楕円（点・外接矩形・Bézier弧）
js/curved-solids.js    円柱・円錐の輪郭線（母線）と縁の可視/不可視弧
js/scene-builder.js    上記を組み合わせ、描画用の平面データ（scene）を作る
js/render-svg.js       scene → SVG文字列
js/export-png.js       SVG → Canvas → PNG、SVG保存（ブラウザ専用）
js/app.js              入力の読み取り・検証・イベント配線（計算ロジックは持たない）
tests/*.test.mjs       node:test による自動テスト（依存なし）
tests/e2e/             Playwrightによるブラウザテスト（開発時のみ）
```

## データフロー

```
[フォーム入力] --app.js（検証）--> [geometry2d | geometry3d]
                                        |
                        projections / hidden-line / curved-solids / ellipse
                                        |
                                        v
                         [scene-builder] 平面データ scene
                         { width, height, items: [polygon|polyline|line|path] }
                                        |
                                        v
                         [render-svg] --> SVG文字列 --> プレビュー
                                        |
                                        v
                         [export-png] --> Canvas --> PNG Blob（ダウンロード）
```

* `app.js` と `export-png.js` 以外は **DOMに依存しない純粋関数**。
  → Node の `node:test` でブラウザなしに自動テストできる。
* `render-svg` はスタイル（線色・線幅・破線・塗り）を presentation
  attribute として明示的に書き出す。CSSクラスに依存しないため、
  SVGを `<img>` として Canvas に描いても見た目が失われない。
* `scene-builder` は図形の外接矩形から縦横比を保ったまま scene のサイズを
  決める（長辺 = 800 − 2×余白）。PNGはこのサイズの 1x/2x/4x、または任意の
  幅で出力し、プレビューの表示サイズには依存しない。

## 2D設計

* `regularPolygon({ sides, sideLength, rotationDeg })` → `{ points }`
  回転角 0 で底辺が水平（正方形が菱形にならない）。
* `triangleFromSSS({ a, b, c })`（a=AB 底辺, b=AC, c=BC）/
  `triangleFromSAS({ sideA, angleA, sideB })`（AB, ∠A, AC）/
  `triangleFromASA({ side, angleA, angleB })`（AB, ∠A, ∠B）
  → `{ ok: true, points }` または `{ ok: false, reason }`
* `generalPolygon({ lengths, headingsDeg })`
  → `{ ok, points, closed, closureError }` または `{ ok: false, reason }`
  頂点は `(0,0)` から `heading[i]` 方向へ `length[i]` 進めて順に計算する。
  閉合誤差が `EPSILON × 周長` を超える場合は `closed: false` とし、形状を
  補正せず開いた折れ線として描く（許容誤差を周長比にすることで、図の
  スケールによって判定が変わらない）。

内部座標は「論理単位」（pxではない）。表示時に scene-builder の
`computeFit` がスケール・平行移動・Y軸反転を行う（アフィン変換なので
Bézier制御点にもそのまま適用できる）。

## 3D設計

* `geometry3d.js` の多面体は `{ vertices, edges, faces }` を返す。面は
  外側から見て反時計回りに並べ、`(v1−v0)×(v2−v0)` が外向き法線になる
  （全形状についてテストで検証）。角柱・角錐の底面は、辺の1つが手前
  （−z）を向くよう配置する（四角錐の底面が軸に平行な正方形になる）。
* `projections.js` の投影はすべて 2×3 行列で表せる **線形写像**：
  * 等角投影: `x' = cos30°·(x − z)`, `y' = y − (x + z)/2`
  * 斜投影: `x' = x + k·z·cosθ`, `y' = y + k·z·sinθ`
    （カバリエ k=1、キャビネット k=0.5、任意斜投影は θ, k を指定）
* `viewDirectionOf(name, options)` は行列の零空間（同じ2D点に写る直線の
  方向）を視聴者側に向けた単位ベクトルを返す。等角投影は (1,1,1)/√3、
  斜投影系は x-y 平面（実長で描かれる面）が手前になるよう
  `(k cosθ, k sinθ, −1)` を正規化したもの。**近似ではなく投影と厳密に
  整合する視線方向**なので、以下の判定・接線計算が正確になる。
* `hidden-line.js`: 面法線と視線方向の内積で面の表裏を判定し、表向きの
  面に1つも属さない辺を隠線とする。凸多面体では厳密（対応する全多面体が
  凸）。凹多面体や複数物体の遮蔽には一般的なアルゴリズムが別途必要。
* `ellipse.js`: 3D円 `C + r(cos t·u + sin t·w)` は線形写像により
  `E(t) = L(C) + A cos t + B sin t` となる。パラメータ t を3D側と共有できる
  ので、可視判定（3D）と描画（2D）を同じ t で扱える。外接矩形は
  `中心 ± hypot(Ax, Bx)` 等で厳密に求まる。弧は円弧のBézier近似
  （1/4周あたり相対誤差 < 3×10⁻⁴）をアフィン写像したものとして出力する。
* `curved-solids.js`: 側面の外向き法線の視線方向成分は
  `n(t)·v = R cos(t − φ)` の形になるため、輪郭線（側面が視線と平行に
  なる母線）の t を閉形式で求められる。
  * 円柱: `n(t)·v = 0`。上下の縁は「底面/上面が表向き」または「その t で
    側面が表向き」のとき可視。
  * 円錐: 側面法線 ∝ `h·n(t) + r·axis` より `h·n(t)·v + r·(axis·v) = 0`。
    頂点が楕円の内側に入る（真上から見る）場合は輪郭線なしで全周可視。
  視線方向が投影と厳密に一致しているため、輪郭線は投影後の楕円に厳密に
  接する（テストで検証）。
* 塗りは、凸立体の投影像が凸であることを利用し、投影点の凸包を線の下に
  描く。隠線（破線）は塗りの上に描かれる。

## 投影と形状の疎結合

* `geometry3d.js` は投影方法を知らない（3D座標を作るだけ）。
* `projections.js` は形状を知らない（行列と視線方向を返すだけ）。
* 新しい投影は `matrixOf` と `viewDirectionOf` に、新しい立体は
  `geometry3d.js` と scene-builder の `SHAPE_FACTORIES` に追加する。

## 将来拡張（v1では未実装だが構造上考慮済み）

* 寸法線・角度ラベル・頂点名: 論理座標の頂点列と、論理座標→SVG座標の
  写像（`computeFit(...).map`）がどちらも得られるため、scene に
  `text` 等の item を追加し render-svg で描画するだけで対応できる。

## テスト方針

* `npm test`: `tests/*.test.mjs`（`node:test` + `node:assert/strict`、依存なし）。
  浮動小数点は用途に応じた許容誤差（1e-9 等）で比較する。
* `npm run test:e2e`: Playwright で実ブラウザを操作し、入力検証、全形状×
  全投影の描画、PNGのサイズ・透明/白背景、SVG保存、コンソールエラー
  なしを確認する。本番動作には不要（devDependency）。
* 両方とも GitHub Actions（`.github/workflows/test.yml`）で実行する。
