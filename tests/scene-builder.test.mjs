import test from 'node:test';
import assert from 'node:assert/strict';
import { regularPolygon } from '../js/geometry2d.js';
import { buildScene2D, buildScene3D, computeFit, convexHull } from '../js/scene-builder.js';
import { renderSvgString } from '../js/render-svg.js';

const SIZE = 800;
const MARGIN = 32;

function allPoints(scene) {
  const pts = [];
  for (const it of scene.items) {
    if (it.points) pts.push(...it.points);
    if (it.d) {
      // "M p C c1 c2 p C c1 c2 p ...": keep on-curve points, skip Bezier control points.
      const pairs = [...it.d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      pts.push(...pairs.filter((_, i) => i % 3 === 0));
    }
  }
  return pts;
}

function assertInsideWithMargin(scene) {
  for (const [x, y] of allPoints(scene)) {
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
    assert.ok(x >= MARGIN - 0.6 && x <= scene.width - MARGIN + 0.6, `x=${x} outside margin`);
    assert.ok(y >= MARGIN - 0.6 && y <= scene.height - MARGIN + 0.6, `y=${y} outside margin`);
  }
}

test('computeFit keeps aspect ratio, puts the longer side at size - 2*margin and flips y', () => {
  const fit = computeFit({ minX: 0, maxX: 200, minY: 0, maxY: 50 }, SIZE, MARGIN);
  assert.equal(fit.width, SIZE);
  assert.equal(fit.height, Math.round(50 * fit.scale + 2 * MARGIN));
  assert.deepEqual(fit.map([0, 50]), [MARGIN, fit.height / 2 - 25 * fit.scale]);
  const [, yBottom] = fit.map([0, 0]);
  assert.ok(yBottom > fit.map([0, 50])[1], 'larger logical y is higher on the page');
});

test('convexHull returns the hull corners only', () => {
  const hull = convexHull([[0, 0], [2, 0], [1, 1], [2, 2], [0, 2], [1, 0.5]]);
  assert.equal(hull.length, 4);
});

test('buildScene2D: well-formed SVG, figure sized to its own aspect ratio', () => {
  const { points } = regularPolygon({ sides: 5, sideLength: 20 });
  const scene = buildScene2D(points, true, { size: SIZE, margin: MARGIN });
  const svg = renderSvgString(scene);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<polygon points="/);
  assert.match(svg, /<\/svg>$/);
  assert.equal(Math.max(scene.width, scene.height), SIZE);
  assertInsideWithMargin(scene);
});

test('buildScene2D: open path renders as a polyline without fill', () => {
  const scene = buildScene2D([[0, 0], [10, 0], [10, 5]], false, { fill: '#ffffff' });
  assert.equal(scene.items[0].type, 'polyline');
  assert.match(renderSvgString(scene), /<polyline [^>]*fill="none"/);
});

test('buildScene3D: cube in cabinet draws 12 edges, exactly 3 dashed', () => {
  const scene = buildScene3D('cube', { size: 40 }, 'cabinet', {}, { hiddenLineMode: 'dashed' });
  assert.equal(scene.items.length, 12);
  assert.equal(scene.items.filter((it) => it.dash).length, 3);
  assert.match(renderSvgString(scene), /stroke-dasharray/);
  assertInsideWithMargin(scene);
});

test('buildScene3D: hiddenLineMode "hidden" omits hidden edges entirely', () => {
  const scene = buildScene3D('cube', { size: 40 }, 'isometric', {}, { hiddenLineMode: 'hidden' });
  assert.equal(scene.items.length, 9);
  assert.ok(scene.items.every((it) => !it.dash));
});

test('buildScene3D: fill adds one unstroked hull polygon beneath the edges', () => {
  const scene = buildScene3D('box', { width: 80, height: 50, depth: 40 }, 'isometric', {}, { fill: '#ffffff' });
  assert.equal(scene.items[0].type, 'polygon');
  assert.equal(scene.items[0].stroke, 'none');
  assert.equal(scene.items[0].points.length, 6, 'a box silhouette in isometric is a hexagon');
});

test('buildScene3D: cylinder = top rim + visible/hidden halves of the bottom rim + 2 silhouettes', () => {
  const scene = buildScene3D('cylinder', { radius: 20, height: 50 }, 'cavalier', {}, {});
  const paths = scene.items.filter((it) => it.type === 'path');
  const lines = scene.items.filter((it) => it.type === 'line');
  assert.equal(paths.length, 3);
  assert.equal(paths.filter((it) => it.dash).length, 1);
  assert.equal(lines.length, 2);
  assert.match(renderSvgString(scene), /<path d="M[^"]+ C/);
  assertInsideWithMargin(scene);
});

test('buildScene2D: annotations off by default (4th arg omitted) renders exactly like v1', () => {
  const { points } = regularPolygon({ sides: 4, sideLength: 20 });
  const withoutArg = buildScene2D(points, true, { size: SIZE, margin: MARGIN });
  const withEmptyAnnotations = buildScene2D(points, true, { size: SIZE, margin: MARGIN }, {});
  assert.deepEqual(withoutArg, withEmptyAnnotations);
});

test('buildScene2D: enabling vertex labels grows the canvas so labels are not clipped', () => {
  const { points } = regularPolygon({ sides: 3, sideLength: 20 });
  const plain = buildScene2D(points, true, { size: SIZE, margin: MARGIN });
  const annotated = buildScene2D(points, true, { size: SIZE, margin: MARGIN }, { vertexLabels: { enabled: true, fontSize: 20, distance: 30 } });
  assert.ok(annotated.width >= plain.width && annotated.height >= plain.height);
  const labels = annotated.items.filter((it) => it.type === 'text');
  assert.equal(labels.length, 3);
  for (const [x, y] of labels.map((l) => l.point)) {
    assert.ok(x >= 0 && x <= annotated.width, `label x=${x} within canvas width ${annotated.width}`);
    assert.ok(y >= 0 && y <= annotated.height, `label y=${y} within canvas height ${annotated.height}`);
  }
});

test('buildScene3D: cone = visible/hidden base arcs + 2 generators; "hidden" mode drops the dashed arc', () => {
  const dashed = buildScene3D('cone', { radius: 20, height: 50 }, 'oblique', { angleDeg: 30, scale: 0.6 }, {});
  assert.equal(dashed.items.filter((it) => it.type === 'path').length, 2);
  assert.equal(dashed.items.filter((it) => it.type === 'line').length, 2);
  const hidden = buildScene3D('cone', { radius: 20, height: 50 }, 'oblique', { angleDeg: 30, scale: 0.6 }, { hiddenLineMode: 'hidden' });
  assert.equal(hidden.items.filter((it) => it.type === 'path').length, 1);
  assertInsideWithMargin(dashed);
});
