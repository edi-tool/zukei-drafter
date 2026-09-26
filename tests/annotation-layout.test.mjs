import test from 'node:test';
import assert from 'node:assert/strict';
import { computeFit } from '../js/scene-builder.js';
import { buildAnnotationItems, normalizeAnnotations, annotationsActive } from '../js/annotation-layout.js';

function bboxOf(points) {
  const bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    bbox.minX = Math.min(bbox.minX, x);
    bbox.maxX = Math.max(bbox.maxX, x);
    bbox.minY = Math.min(bbox.minY, y);
    bbox.maxY = Math.max(bbox.maxY, y);
  }
  return bbox;
}

const TRIANGLE = [[0, 0], [40, 0], [0, 30]]; // 3-4-5 right triangle scaled by 10

function fitFor(points) {
  return computeFit(bboxOf(points), 400, 20);
}

test('normalizeAnnotations: everything defaults to off / sane values', () => {
  const a = normalizeAnnotations();
  assert.equal(a.vertexLabels.enabled, false);
  assert.equal(a.edgeLengths.mode, 'off');
  assert.equal(a.angles.enabled, false);
  assert.equal(a.rightAngles.mode, 'hidden');
});

test('annotationsActive: false when nothing is enabled, true once one thing is on', () => {
  assert.equal(annotationsActive({}), false);
  assert.equal(annotationsActive({ vertexLabels: { enabled: true } }), true);
  assert.equal(annotationsActive({ edgeLengths: { mode: 'text' } }), true);
});

test('vertex label placement (triangle): one text item per vertex, outside the triangle', () => {
  const fit = fitFor(TRIANGLE);
  const { items } = buildAnnotationItems(TRIANGLE, true, fit, { vertexLabels: { enabled: true, fontSize: 16, distance: 14 } });
  const labels = items.filter((it) => it.type === 'text');
  assert.equal(labels.length, 3);
  assert.deepEqual(labels.map((l) => l.text), ['A', 'B', 'C']);
  // Each label should sit outside the triangle's own mapped bounding box.
  const shapeBBox = bboxOf(TRIANGLE.map(fit.map));
  const margin = -1e-6;
  for (const label of labels) {
    const [x, y] = label.point;
    const outside = x < shapeBBox.minX + margin || x > shapeBBox.maxX - margin || y < shapeBBox.minY + margin || y > shapeBBox.maxY - margin;
    assert.ok(outside, `label ${label.text} at (${x},${y}) should be outside the triangle bbox ${JSON.stringify(shapeBBox)}`);
  }
});

test('edge length labels (square): one label per edge, text mode has no dimension lines', () => {
  const square = [[0, 0], [50, 0], [50, 50], [0, 50]];
  const fit = fitFor(square);
  const { items } = buildAnnotationItems(square, true, fit, { edgeLengths: { mode: 'text', unit: 'none', decimals: 0, fontSize: 14 } });
  const texts = items.filter((it) => it.type === 'text');
  assert.equal(texts.length, 4);
  for (const t of texts) assert.equal(t.text, '50');
  assert.equal(items.filter((it) => it.type === 'line').length, 0, 'text mode should not draw dimension lines');
});

test('dimension line offset: the dimension line moves further from the edge as offset increases', () => {
  const square = [[0, 0], [50, 0], [50, 50], [0, 50]];
  const fit = fitFor(square);
  const small = buildAnnotationItems(square, true, fit, { edgeLengths: { mode: 'dimension', offset: 10, fontSize: 14 } });
  const large = buildAnnotationItems(square, true, fit, { edgeLengths: { mode: 'dimension', offset: 40, fontSize: 14 } });
  // The bottom edge (index 0) normal points -y (down, larger SVG y); its
  // dimension line should be pushed further down (larger y) for the larger offset.
  const dimLineOf = (result) => result.items.filter((it) => it.type === 'line' && Math.abs(it.points[0][1] - it.points[1][1]) < 1e-6);
  const smallY = dimLineOf(small)[0].points[0][1];
  const largeY = dimLineOf(large)[0].points[0][1];
  assert.ok(largeY > smallY, `larger offset (${largeY}) should push the dimension line further than the smaller offset (${smallY})`);
});

test('dimension line mode includes a length text plus extension/dimension lines', () => {
  const square = [[0, 0], [50, 0], [50, 50], [0, 50]];
  const fit = fitFor(square);
  const { items } = buildAnnotationItems(square, true, fit, { edgeLengths: { mode: 'dimension', unit: 'cm', decimals: 1, offset: 20, fontSize: 14 } });
  const texts = items.filter((it) => it.type === 'text');
  assert.equal(texts.length, 4);
  for (const t of texts) assert.equal(t.text, '5.0 cm');
  assert.ok(items.filter((it) => it.type === 'line').length > 4, 'expects extension lines, dimension lines and arrow ticks');
});

test('angle annotation (60 degree vertex): arc + value label present, value formatted', () => {
  const triangle = [[0, 0], [10, 0], [5, 5 * Math.sqrt(3)]]; // equilateral
  const fit = fitFor(triangle);
  const { items } = buildAnnotationItems(triangle, true, fit, { angles: { enabled: true, showValue: true, decimals: 0, radius: 20, fontSize: 12 }, rightAngles: { mode: 'hidden' } });
  const labels = items.filter((it) => it.type === 'text');
  assert.equal(labels.length, 3);
  for (const l of labels) assert.equal(l.text, '60°');
  assert.equal(items.filter((it) => it.type === 'polyline').length, 3, 'one arc polyline per vertex');
});

test('angle annotation (90 degree vertex): right-angle square drawn, arc skipped for that vertex', () => {
  const square = [[0, 0], [50, 0], [50, 50], [0, 50]];
  const fit = fitFor(square);
  const { items } = buildAnnotationItems(square, true, fit, { angles: { enabled: true, showValue: true, radius: 20, fontSize: 12 }, rightAngles: { mode: 'auto' } });
  // 4 right-angle marks, no 90° arcs/labels (right-angle mark takes priority).
  assert.equal(items.filter((it) => it.type === 'text').length, 0);
  assert.equal(items.filter((it) => it.type === 'polyline').length, 4);
});

test('angle annotation (120 degree vertex, regular hexagon): all six angles reported as 120', () => {
  const hex = [[10, 0], [5, 8.660254], [-5, 8.660254], [-10, 0], [-5, -8.660254], [5, -8.660254]];
  const fit = fitFor(hex);
  const { items } = buildAnnotationItems(hex, true, fit, { angles: { enabled: true, showValue: true, radius: 15, fontSize: 12 }, rightAngles: { mode: 'hidden' } });
  const labels = items.filter((it) => it.type === 'text');
  assert.equal(labels.length, 6);
  for (const l of labels) assert.equal(l.text, '120°');
});

test('right angle mode "hidden" never draws the square, even for a 90 degree vertex', () => {
  const square = [[0, 0], [50, 0], [50, 50], [0, 50]];
  const fit = fitFor(square);
  const { items } = buildAnnotationItems(square, true, fit, { rightAngles: { mode: 'hidden' } });
  assert.equal(items.length, 0);
});

test('buildAnnotationItems: returns no items and null bbox when everything is off', () => {
  const square = [[0, 0], [50, 0], [50, 50], [0, 50]];
  const fit = fitFor(square);
  const { items, bbox } = buildAnnotationItems(square, true, fit, {});
  assert.equal(items.length, 0);
  assert.equal(bbox, null);
});
