import test from 'node:test';
import assert from 'node:assert/strict';
import { regularPolygon, triangleFromSSS, triangleFromSAS, triangleFromASA, generalPolygon } from '../js/geometry2d.js';
import {
  annotate2D,
  estimateTextBox,
  formatNumber,
  hasAnnotations,
  isRightAngle,
  pointInPolygon,
  segmentHitsRect,
  vertexAngles,
  vertexName,
} from '../js/annotations.js';
import { buildScene2D } from '../js/scene-builder.js';
import { renderSvgString } from '../js/render-svg.js';

const SIZE = 800;
const MARGIN = 32;
const ALL = { vertexNames: true, lengths: 'label', angles: true, unit: 'cm', decimals: 1, fontSize: 18 };
const ALL_DIM = { ...ALL, lengths: 'dimension' };
// Map used for direct annotate2D tests: scale 10, y flipped (like computeFit).
const MAP = ([x, y]) => [100 + 10 * x, 500 - 10 * y];

const SHAPES = {
  hexagon: [regularPolygon({ sides: 6, sideLength: 40 }).points, true],
  triangle345: [triangleFromSSS({ a: 3, b: 4, c: 5 }).points, true],
  thinSAS: [triangleFromSAS({ sideA: 80, angleA: 12, sideB: 70 }).points, true],
  obtuseASA: [triangleFromASA({ side: 60, angleA: 120, angleB: 25 }).points, true],
  tallNarrow: [triangleFromSAS({ sideA: 10, angleA: 90, sideB: 100 }).points, true],
  lShape: [generalPolygon({ lengths: [60, 20, 30, 40, 30, 60], headingsDeg: [0, 90, 180, 90, 180, 270] }).points, true],
  clockwiseSquare: [[[0, 0], [0, 10], [10, 10], [10, 0]], true],
  open: [generalPolygon({ lengths: [50, 40, 40, 40], headingsDeg: [0, 90, 180, 260] }).points, false],
};

const texts = (items) => items.filter((it) => it.type === 'text').map((it) => it.text);
const rect = (l) => ({
  minX: l.center[0] - l.box.width / 2,
  maxX: l.center[0] + l.box.width / 2,
  minY: l.center[1] - l.box.height / 2,
  maxY: l.center[1] + l.box.height / 2,
});
const overlap = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
const edgesOf = (px, closed) => {
  const out = [];
  for (let i = 0; i < (closed ? px.length : px.length - 1); i++) out.push([px[i], px[(i + 1) % px.length]]);
  return out;
};

test('formatNumber drops trailing zeros after rounding', () => {
  assert.equal(formatNumber(40, 1), '40');
  assert.equal(formatNumber(36.8699, 1), '36.9');
  assert.equal(formatNumber(2.5, 0), '3');
  assert.equal(formatNumber(1.2, 3), '1.2');
  assert.equal(formatNumber(-0.00001, 2), '0');
});

test('vertexName runs A..Z then A1..', () => {
  assert.deepEqual([0, 1, 25, 26, 27].map(vertexName), ['A', 'B', 'Z', 'A1', 'B1']);
});

test('hasAnnotations is false for null / everything off', () => {
  assert.equal(hasAnnotations(null), false);
  assert.equal(hasAnnotations({ vertexNames: false, angles: false, lengths: 'none' }), false);
  assert.equal(hasAnnotations({ lengths: 'label' }), true);
  assert.equal(hasAnnotations({ angles: true }), true);
});

test('estimateTextBox grows with length and treats full-width characters as 1em', () => {
  const a = estimateTextBox('40', 20);
  const b = estimateTextBox('40cm', 20);
  assert.ok(b.width > a.width);
  assert.equal(a.height, 20);
  assert.equal(estimateTextBox('辺', 20).width, 20);
});

test('vertexAngles: 3-4-5 triangle, independent of orientation and scale', () => {
  const pts = SHAPES.triangle345[0];
  const deg = vertexAngles(pts, true).map((a) => a.interiorDeg);
  assert.ok(Math.abs(deg[0] - 90) < 1e-9);
  assert.ok(Math.abs(deg[1] - (Math.atan2(4, 3) * 180) / Math.PI) < 1e-9);
  assert.ok(Math.abs(deg.reduce((s, d) => s + d, 0) - 180) < 1e-9);
  const reversed = vertexAngles([...pts].reverse(), true).map((a) => a.interiorDeg).reverse();
  reversed.forEach((d, i) => assert.ok(Math.abs(d - deg[i]) < 1e-9));
  const mapped = vertexAngles(pts.map(MAP), true).map((a) => a.interiorDeg);
  mapped.forEach((d, i) => assert.ok(Math.abs(d - deg[i]) < 1e-9, 'y flip + scale keeps angles'));
});

test('vertexAngles: reflex and straight vertices, interior bisector points inside', () => {
  const [pts] = SHAPES.lShape;
  const deg = vertexAngles(pts, true).map((a) => Math.round(a.interiorDeg));
  assert.deepEqual(deg, [90, 90, 90, 270, 90, 90]);
  const withStraight = [[0, 0], [5, 0], [10, 0], [10, 10], [0, 10]];
  const angles = vertexAngles(withStraight, true);
  assert.ok(Math.abs(angles[1].interiorDeg - 180) < 1e-9);
  for (const [i, a] of angles.entries()) {
    const probe = [withStraight[i][0] + 0.5 * a.bisector[0], withStraight[i][1] + 0.5 * a.bisector[1]];
    assert.ok(pointInPolygon(probe, withStraight), `bisector of vertex ${i} points inside`);
  }
});

test('vertexAngles: open path has no angle at its ends', () => {
  const [pts] = SHAPES.open;
  const angles = vertexAngles(pts, false);
  assert.equal(angles[0], null);
  assert.equal(angles[angles.length - 1], null);
  assert.equal(angles.filter(Boolean).length, pts.length - 2);
});

test('segmentHitsRect and pointInPolygon', () => {
  const r = { minX: 0, maxX: 10, minY: 0, maxY: 10 };
  assert.equal(segmentHitsRect([-5, 5], [15, 5], r), true, 'crosses');
  assert.equal(segmentHitsRect([2, 2], [3, 3], r), true, 'inside');
  assert.equal(segmentHitsRect([-5, -5], [-1, 20], r), false, 'passes left');
  assert.equal(segmentHitsRect([-5, 5], [-1, 5], r), false, 'stops short');
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  assert.equal(pointInPolygon([5, 5], square), true);
  assert.equal(pointInPolygon([15, 5], square), false);
});

test('annotate2D: texts for a 3-4-5 triangle with every annotation', () => {
  const [pts] = SHAPES.triangle345;
  const { items } = annotate2D(pts, true, MAP, ALL);
  assert.deepEqual(texts(items).sort(), ['3cm', '4cm', '5cm', '36.9°', '53.1°', '90°', 'A', 'B', 'C'].sort());
  assert.equal(items.filter((it) => it.type === 'path').length, 3, 'one arc per angle');
});

test('annotate2D: nothing enabled gives nothing', () => {
  const [pts] = SHAPES.hexagon;
  const res = annotate2D(pts, true, MAP, {});
  assert.deepEqual(res.items, []);
  assert.equal(res.bounds, null);
});

test('isRightAngle: exact and epsilon-tolerant 90 degrees, but not 89/91 outside epsilon', () => {
  assert.equal(isRightAngle(90), true);
  assert.equal(isRightAngle(90.0000003), true, 'within default epsilon (float error)');
  assert.equal(isRightAngle(89.9999997), true, 'within default epsilon (float error)');
  assert.equal(isRightAngle(89.4), false);
  assert.equal(isRightAngle(60), false);
  assert.equal(isRightAngle(120), false);
});

test('hasAnnotations treats rightAngles:"auto" as an active annotation on its own', () => {
  assert.equal(hasAnnotations({ rightAngles: 'auto' }), true);
  assert.equal(hasAnnotations({ rightAngles: 'hidden' }), false);
  assert.equal(hasAnnotations(null), false);
});

test('annotate2D: rightAngles "auto" draws a mark at the 90deg vertex of a 3-4-5 triangle and suppresses its arc/value', () => {
  const [pts] = SHAPES.triangle345;
  const { items } = annotate2D(pts, true, MAP, { ...ALL, rightAngles: 'auto' });
  // The right angle at C (90°) is replaced by a 2-segment mark; the other two
  // vertices (36.9°, 53.1°) still get their arc + value as usual.
  assert.equal(items.filter((it) => it.type === 'path').length, 2, 'right-angle vertex has no arc');
  assert.deepEqual(texts(items).sort(), ['3cm', '4cm', '5cm', '36.9°', '53.1°', 'A', 'B', 'C'].sort(), 'no "90°" label');
});

test('annotate2D: rightAngles "auto" draws no mark and rightAngles "hidden" is a no-op on a 60deg triangle', () => {
  const equilateral = regularPolygon({ sides: 3, sideLength: 10 }).points;
  const auto = annotate2D(equilateral, true, MAP, { rightAngles: 'auto' });
  const hidden = annotate2D(equilateral, true, MAP, { rightAngles: 'hidden' });
  assert.deepEqual(auto.items, [], 'no 90 degree corners on an equilateral triangle');
  assert.deepEqual(hidden.items, []);
});

test('annotate2D: rightAngles "auto" marks all four corners of a square', () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const { items } = annotate2D(square, true, MAP, { rightAngles: 'auto', fontSize: 18 });
  assert.equal(items.filter((it) => it.type === 'line').length, 8, 'two line segments per corner x 4 corners');
  assert.equal(items.filter((it) => it.type === 'text').length, 0, 'no angle labels drawn for the marks themselves');
});

test('annotate2D: dimension lines add two extension lines, one dimension line and two arrows per edge', () => {
  const [pts] = SHAPES.hexagon;
  const { items } = annotate2D(pts, true, MAP, { lengths: 'dimension', decimals: 0 });
  assert.equal(items.filter((it) => it.type === 'line').length, 6 * 3);
  assert.equal(items.filter((it) => it.type === 'polygon').length, 6 * 2);
  assert.deepEqual(texts(items), Array(6).fill('40'));
});

test('annotate2D: open path labels n-1 edges and n-2 angles', () => {
  const [pts] = SHAPES.open;
  const { items } = annotate2D(pts, false, MAP, ALL);
  const t = texts(items);
  assert.equal(t.filter((s) => s.endsWith('cm')).length, pts.length - 1);
  assert.equal(t.filter((s) => s.endsWith('°')).length, pts.length - 2);
  assert.equal(t.filter((s) => /^[A-Z]$/.test(s)).length, pts.length);
});

for (const [name, [pts, closed]] of Object.entries(SHAPES)) {
  for (const [optName, opts] of [['labels', ALL], ['dimension', ALL_DIM]]) {
    test(`annotate2D layout (${name}, ${optName}): labels never overlap each other or cross the figure`, () => {
      const px = pts.map(MAP);
      const { labels } = annotate2D(pts, closed, MAP, opts);
      const rects = labels.map(rect);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          assert.ok(!overlap(rects[i], rects[j]), `"${labels[i].text}" overlaps "${labels[j].text}"`);
        }
        for (const [p, q] of edgesOf(px, closed)) {
          assert.ok(!segmentHitsRect(p, q, rects[i]), `"${labels[i].text}" crosses an edge`);
        }
      }
      if (closed) {
        for (const l of labels) {
          const isVertexName = /^[A-Z]$/.test(l.text);
          const isLength = l.text.endsWith('cm');
          if (isVertexName || isLength) assert.ok(!pointInPolygon(l.center, px), `"${l.text}" should be outside`);
        }
      }
    });
  }
}

test('annotate2D: angle values stay inside a roomy figure', () => {
  for (const key of ['hexagon', 'triangle345', 'lShape', 'clockwiseSquare']) {
    const [pts] = SHAPES[key];
    // Scale the figure to ~500px, as buildScene2D would.
    const span = Math.max(...pts.flat()) - Math.min(...pts.flat());
    const map = ([x, y]) => [(500 * x) / span, (-500 * y) / span];
    const px = pts.map(map);
    for (const l of annotate2D(pts, true, map, ALL).labels.filter((l) => l.text.endsWith('°'))) {
      assert.ok(pointInPolygon(l.center, px), `${key}: "${l.text}" inside`);
    }
  }
});

test('buildScene2D: no / all-off annotation gives exactly the plain figure', () => {
  const [pts] = SHAPES.hexagon;
  const plain = renderSvgString(buildScene2D(pts, true));
  assert.equal(renderSvgString(buildScene2D(pts, true, {}, null)), plain);
  assert.equal(renderSvgString(buildScene2D(pts, true, {}, { vertexNames: false, angles: false, lengths: 'none', unit: 'cm' })), plain);
  assert.ok(!plain.includes('<text'));
});

for (const [name, [pts, closed]] of Object.entries(SHAPES)) {
  test(`buildScene2D (${name}): annotations fit inside the margin, longer side stays ${SIZE}`, () => {
    for (const opts of [ALL, ALL_DIM, { ...ALL, fontSize: 40 }]) {
      const scene = buildScene2D(pts, closed, {}, opts);
      assert.equal(Math.max(scene.width, scene.height), SIZE);
      const inside = ([x, y]) => {
        assert.ok(x >= MARGIN - 0.6 && x <= scene.width - MARGIN + 0.6, `x=${x}`);
        assert.ok(y >= MARGIN - 0.6 && y <= scene.height - MARGIN + 0.6, `y=${y}`);
      };
      for (const it of scene.items) {
        if (it.points) it.points.forEach(inside);
        if (it.type === 'text') {
          const box = estimateTextBox(it.text, it.fontSize);
          const cy = it.y - 0.36 * it.fontSize;
          inside([it.x - box.width / 2, cy - box.height / 2]);
          inside([it.x + box.width / 2, cy + box.height / 2]);
        }
      }
    }
  });
}

test('render-svg: text is escaped and uses system fonts only', () => {
  const svg = renderSvgString({
    width: 100,
    height: 100,
    items: [{ type: 'text', x: 50, y: 50, text: '<a&b>', fontSize: 18, fill: '#123456' }],
  });
  assert.match(svg, /<text [^>]*text-anchor="middle"[^>]*>&lt;a&amp;b&gt;<\/text>/);
  assert.match(svg, /font-size="18"/);
  assert.match(svg, /fill="#123456"/);
  assert.ok(!/url\(|@font-face|@import/.test(svg), 'no external font reference');
});
