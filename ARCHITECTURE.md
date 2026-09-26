# ARCHITECTURE

## 全体像

依存ライブラリなしの静的サイト。責務ごとにモジュールを分割し、
`<script type="module">` で読み込む（ビルド不要、GitHub Pagesにそのまま
配置可能。`.nojekyll` によりJekyll処理を経ずファイルをそのまま配信）。

```
index.html                エントリーポイント / DOM構造
css/style.css             レイアウト・見た目
js/geometry2d.js          2D幾何計算（座標のみを返す）
js/geometry3d.js          3D形状データ生成（頂点・辺・面、円柱/円錐の解析的表現）
js/projections.js         3D→2D投影（線形写像）と、その正確な投影方向（視線）
js/hidden-line.js         多面体の可視/不可視エッジ判定
js/ellipse.js             円の投影＝パラメトリック楕円（点・外接矩形・Bézier弧）
js/curved-solids.js       円柱・円錐の輪郭線（母線）と縁の可視/不可視弧
js/annotations.js         2D注釈の純粋な幾何計算（頂点方向・辺・内角・書式）
js/annotation-layout.js   注釈計算 → scene item（text/line/polyline）への変換
js/scene-builder.js       上記を組み合わせ、描画用の平面データ（scene）を作る
js/render-svg.js          scene → SVG文字列
js/export-png.js          SVG → Canvas → PNG、SVG保存（ブラウザ専用）
js/app.js                 入力の読み取り・検証・イベント配線（計算ロジックは持たない）
tests/*.test.mjs          node:test による自動テスト（依存なし）
tests/e2e/                Playwrightによるブラウザテスト（開発時のみ）
```

## データフロー

```
[フォーム入力] --app.js（検証）--> [geometry2d | geometry3d]
                                        |
                        projections / hidden-line / curved-solids / ellipse
                                        |
                                        v
                    (2Dのみ) [annotations.js] 頂点方向・辺・内角の純粋計算
                                        |
                                        v
                    (2Dのみ) [annotation-layout.js] fit.map を通した
                             text/line/polyline item への変換
                                        |
                                        v
                         [scene-builder] 平面データ scene
                    { width, height, items: [polygon|polyline|line|path|text|ellipse] }
                                        |
                                        v
                         [render-svg] --> SVG文字列 --> プレビュー
                                        |
                                        v
                         [export-png] --> Canvas --> PNG Blob（ダウンロード）
```

`annotations.js` → `annotation-layout.js` → scene という三段構成にすることで、
render-svg には一切の幾何計算を持ち込まない（これまでどおり scene item を
そのままマークアップに変換するだけ）。render-svg / export-png からは
注釈の有無を意識する必要がない。

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

## 2D注釈（v1.1）

* `js/annotations.js`: 論理座標のみを扱う純粋関数。
  * `vertexOutwardDirections`: 各頂点の外向き単位ベクトル。隣接2辺の
    内角二等分線を反転したものを基本とし（凹頂点でも中心方向と整合する
    符号を選ぶ）、退化ケース（直線状の頂点・開いた経路）は中心→頂点方向に
    フォールバックする。
  * `edgeGeometry`: 各辺の長さ・中点・単位方向・外向き法線（中心の逆側）。
  * `interiorAngles`: 各頂点の内角を「回転角（turning angle）」から
    `180° − 回転角` として求める。多角形の向き（時計/反時計）を
    `signedArea` の符号から判定して回転角の符号を揃えるため、凸・凹どちらの
    頂点でも正しい値になる（`(n-2)×180°` になることをテストで確認）。
  * `isRightAngle`: 既定 `epsilonDeg = 0.5°` で90°判定（浮動小数点誤差対策）。
  * `formatLength` / `formatAngle`: 単位変換・小数桁のフォーマットのみを
    担当する純粋関数（DOM/fitに依存しないためテストしやすい）。
* `js/annotation-layout.js`: 上記の幾何情報と、UIのピクセル単位設定
  （フォントサイズ・距離・オフセット・弧の半径）、`fit`（`scale` と
  `map`）を受け取り、`fit.map` 済みの scene item（`text` / `line` /
  `polyline`）を返す。ピクセル距離は `pixelsToLogical(px, fit.scale)` で
  一度論理単位に変換してから頂点座標に加算し、最後に `fit.map` で
  ピクセルへ戻す。こうすることで「図形からの距離14px」のような設定が
  図形の実寸によらず常に同じ見た目になる。
  * 辺の長さは `edgeMode` で `text`（中点付近にテキストのみ）と
    `dimension`（補助線＋寸法線＋矢印＋数値）を切り替える。両方を同時に
    出さない設計にすることで「重複しないUI」という要件を満たしている。
  * 角度の弧は、頂点から見た「前の頂点への方向」を始点として、
    `interiorAngles` が返す内角ぶんだけ実際に掃引する向き（時計/反時計）を
    符号判定してから24分割の折れ線としてサンプリングする（ベジェではなく
    ポリラインなので、後段の「注釈込みでキャンバスを広げる」処理で
    座標の平行移動だけで済む）。
  * 直角記号（90°判定）が有効な頂点は、視覚的な重複を避けるため
    その頂点の角度弧・角度値の描画をスキップし、直角記号（角に沿った
    小さな正方形）だけを描く。
* 依存関係は一方向（`annotations.js` → `annotation-layout.js` →
  `scene-builder.js` → `render-svg.js`）。render-svg は `text` /
  `ellipse` という item type を新たに理解するだけで、注釈固有のロジックは
  一切持たない。

### 自動フィット（注釈を含めた二段階フィット）

`buildScene2D` は注釈が有効なときだけ次の二段階処理を行う（無効なら
v1と全く同じ一段階の `computeFit` のみ・同一出力）。

1. 図形の頂点だけから通常どおり `computeFit` してプレビュー用の
   スケール・オフセットを求め、図形と全注釈item（ピクセル座標）を計算する。
2. 全注釈itemの外接矩形を、テキストは概算バウンディングボックスで、
   線・折れ線は端点そのもので求め、キャンバスの余白（`margin`）を
   はみ出す量だけキャンバスを拡張し、全itemを平行移動する（`fit`は
   アフィン写像なので、平行移動を later に足すだけで済み再計算不要）。

テキストの正確な幅はDOM/canvasの `measureText` なしには求められないため、
`annotation-layout.js` の `textBBox` は「1文字あたり概ね `0.62em`」という
概算（等幅よりやや狭いサンセリフ半角文字の目安）を使い、回転している
テキストは対角線を半径とする円で安全側に近似している。これは実測ではなく
概算である旨をコード中のコメントと本ドキュメントに明記する（要求どおり）。

## 将来拡張（v1.1でも未実装だが構造上考慮済み）

* **3D注釈（寸法線）**: 現状の `annotation-layout.js` は2D専用（`fit.map`
  が2D論理座標を前提）だが、3Dの辺の長さ・半径・直径は
  `geometry3d.js` の頂点情報と、投影後の2D座標（`applyMatrix` の結果）
  さえあれば同じ「幾何計算 → scene item」という形にできる。今回のv1.1では
  「隠線と注釈の重なり」「投影ごとに寸法線の向きが変わる」といった検討が
  追加で必要なため、無理に2Dの実装を流用せず見送った（HANDOFF.md参照）。
* 頂点名・辺長・角度の文字が3D側にも必要になった場合、`annotations.js` の
  `formatLength` / `formatAngle` はそのまま再利用できる。

## テスト方針

* `npm test`: `tests/*.test.mjs`（`node:test` + `node:assert/strict`、依存なし）。
  浮動小数点は用途に応じた許容誤差（1e-9 等）で比較する。
* `npm run test:e2e`: Playwright で実ブラウザを操作し、入力検証、全形状×
  全投影の描画、PNGのサイズ・透明/白背景、SVG保存、コンソールエラー
  なしを確認する。本番動作には不要（devDependency）。
* 両方とも GitHub Actions（`.github/workflows/test.yml`）で実行する。
