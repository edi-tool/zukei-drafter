# ARCHITECTURE

## 全体像

依存ライブラリなしの静的サイト。責務ごとにモジュールを分割し、
`<script type="module">` で読み込む（ビルド不要、GitHub Pagesにそのまま
配置可能）。

```
index.html          エントリーポイント / DOM構造
css/style.css        レイアウト・見た目
js/geometry2d.js      2D幾何計算（座標のみを返す。DOM/SVGに依存しない）
js/geometry3d.js      3D形状データ生成（頂点・辺・面。DOM/SVGに依存しない）
js/projections.js     3D→2D投影関数（純粋関数）
js/hidden-line.js     多面体の可視/不可視エッジ判定
js/ellipse.js         円/円柱/円錐の投影＝楕円のパラメータ解析
js/render-svg.js      計算結果からSVG DOMを構築する（副作用: DOM操作）
js/export-png.js      SVG→Canvas→PNG（およびSVG保存）
js/app.js             UI状態管理・イベント配線（上記モジュールを呼ぶだけ）
tests/                node:test による自動テスト（幾何計算の検証）
```

## データフロー

```
[UI入力] --state--> [geometry2d / geometry3d + projections + hidden-line]
                         |
                         v
                  正規化された「描画用ジオメトリ」
                  { polylines, ellipses, viewBox, ... }
                         |
                         v
                  [render-svg] --> SVG DOM (プレビュー)
                         |
                         v
                  [export-png] --> Canvas --> PNG Blob (ダウンロード)
```

* 幾何計算モジュール（geometry2d / geometry3d / projections / hidden-line /
  ellipse）は **純粋関数** とし、DOMやSVGへの参照を一切持たない。
  → node:test でDOM無しに自動テストできる。
* render-svg は「描画用ジオメトリ」だけを受け取り、SVG要素を構築する。
  スタイル（線色・線幅・破線・塗り）は options として渡す。
* export-png は既存のSVG要素（またはSVG文字列）とサイズ・背景設定を受け
  取り、Canvas経由でPNG Blobを生成する。SVG自体の保存もここに実装する。
* app.js はフォーム入力を読み取り、上記関数を呼び出してSVGを再描画する
  だけの薄い層。ビジネスロジックを持たない。

## 2D設計

* `regularPolygon({ sides, sideLength, rotationDeg })`
  → `{ points: [[x,y], ...] }`
* `triangleFromSSS({ a, b, c })` / `triangleFromSAS({ a, angleC, b })` /
  `triangleFromASA({ side, angleA, angleB })`
  → `{ ok: true, points }` または `{ ok: false, reason }`
* `generalPolygon({ lengths, headingsDeg })`
  → `{ points, closed, closureError }`
  頂点は `(0,0)` を起点として `heading[i]` 方向へ `length[i]` 進めて
  順に計算する。最終点と始点の距離が `EPSILON` を超える場合
  `closed: false` とする（形状を勝手に補正しない）。

内部座標は「論理単位」（mm相当、pxではない）。SVGへ渡す直前に
`fitToViewBox(points, { width, height, margin })` でスケール・平行移動する。

## 3D設計

* `geometry3d.js` は形状ごとに
  `{ vertices: [{x,y,z}], edges: [[i,j]], faces: [[i,j,k,...]] }` を返す
  ファクトリ関数を持つ（`cube`, `box`, `triangularPrism`,
  `quadrangularPrism`, `triangularPyramid`, `quadrangularPyramid` は
  多面体として扱い、`cylinder` / `cone` は専用の解析的表現
  （底面円・頂点・軸）を返す）。
* `projections.js` は `projectIsometric(p)`, `projectCabinet(p, opt)`,
  `projectCavalier(p, opt)`, `projectOblique(p, opt)` を提供する。
  いずれも **3D→2Dの線形写像** として実装しており（回転→軸破棄、または
  奥行きの線形加算）、円のアフィン像が厳密に楕円になる性質を
  `ellipse.js` で利用する。
* `hidden-line.js` は多面体の面法線と近似視線ベクトルの内積符号から
  各面の表裏を判定し、両側とも裏向きの面にしか属さない辺を「隠線」と
  判定する（凸多面体前提の近似。v1では一般の凹多面体・自己遮蔽の完全な
  解法は目指さない）。
* `ellipse.js` は「3D円 (中心, 半径, 平面) を線形写像で2Dに投影すると
  パラメトリック楕円 `C + A cosθ + B sinθ` になる」性質を使い、
  長短軸・回転角を解析的に求める。円柱の側面輪郭（接線）は、両底面円で
  共通のθにおいてx方向極値をとる2点を接点として近似する。円錐の母線は
  頂点からの楕円への接線を解析的に求める。

## 投影と形状の疎結合

* `geometry3d.js` は投影方法を一切知らない（純粋に3D座標を作るだけ）。
* `projections.js` は形状を一切知らない（点を受け取り点を返すだけ）。
* 新しい投影法・新しい立体を追加する場合、既存コードの変更は不要で
  それぞれのモジュールに関数を追加するだけでよい（Open/Closed）。

## 将来拡張（v1では未実装だが構造上考慮済み）

* 寸法線・角度ラベル・頂点名の描画は、`render-svg.js` に
  「ジオメトリ→注釈」の別関数を追加するだけで対応できるよう、
  ジオメトリ計算結果（頂点・辺の実座標）をそのまま公開する設計にした。
* SVG保存は `export-png.js` に隣接する形で実装済み（v1で対応）。

## テスト方針

* `tests/*.test.mjs` は Node.js 標準の `node:test` + `node:assert/strict`
  のみを使用（追加の依存なし）。`npm test` で実行できる。
* 浮動小数点比較は `EPSILON = 1e-6` を用いた許容誤差比較で行う。
* ブラウザUIの手動検証はマイルストーンごとに実施し、結果は最終報告に
  記載する（自動E2Eテストは本番動作に必須としない）。
