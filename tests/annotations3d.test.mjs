import test from 'node:test';
import assert from 'node:assert/strict';
import { box, cylinder, cone, triangularPyramid } from '../js/geometry3d.js';
import { matrixOf, applyMatrix, viewDirectionOf } from '../js/projections.js';
import { classifyEdges } from '../js/hidden-line.js';
import { computeFit } from '../js/scene-builder.js';
import { polyhedronDimensionItems, curvedDimensionItems, hasDimensions3D } from '../js/annotations3d.js';

const OPTIONS = { show: true, unit: 'cm', decimals: 1, fontSize: 18, color: '#111111', strokeWidth: 2 };

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

function setupBox(width, height, depth, projection = 'isometric', projectionOptions = {}) {
  const shape = box({ width, height, depth });
  const matrix = matrixOf(projection, projectionOptions);
  const viewDir = viewDirectionOf(projection, projectionOptions);
  const projected = shape.vertices.map((p) => applyMatrix(matrix, p));
  const fit = computeFit(bboxOf(projected), 800, 32);
  const mapped = projected.map(fit.map);
  const project = (v3d) => fit.map(applyMatrix(matrix, v3d));
  const { hidden } = classifyEdges(shape.vertices, shape.faces, shape.edges, viewDir);
  return { shape, mapped, project, hidden };
}

test('hasDimensions3D is false by default, true only when show is set', () => {
  assert.equal(hasDimensions3D(null), false);
  assert.equal(hasDimensions3D({}), false);
  assert.equal(hasDimensions3D({ show: false }), false);
  assert.equal(hasDimensions3D({ show: true }), true);
});

test('polyhedronDimensionItems: off (show:false) draws nothing', () => {
  const { shape, mapped, project, hidden } = setupBox(80, 50, 40);
  const result = polyhedronDimensionItems(shape, mapped, project, hidden, { ...OPTIONS, show: false });
  assert.deepEqual(result, { items: [], bounds: null });
});

test('polyhedronDimensionItems: a box labels width, depth and height, each with its value and unit', () => {
  const { shape, mapped, project, hidden } = setupBox(80, 50, 40);
  const { items, bounds } = polyhedronDimensionItems(shape, mapped, project, hidden, OPTIONS);
  const texts = items.filter((it) => it.type === 'text').map((it) => it.text).sort();
  assert.deepEqual(texts, ['幅 80cm', '奥行き 40cm', '高さ 50cm'].sort());
  assert.ok(bounds);
  // No dimension line is dashed: every one of a box's dimensions is a real edge.
  assert.equal(items.filter((it) => it.type === 'line' && it.dash).length, 0);
});

test('geometry3d box dimensions: every group (width/depth/height) has at least one visible edge, under every projection', () => {
  // Guards the `edges` candidate lists in geometry3d.js `box()`: if a group only
  // listed edges that happen to be hidden under some projection, the dimension
  // line would fall back to a hidden edge and its offset can then land inside
  // the box's own silhouette (see annotations3d.js `visibleEdge`).
  for (const [name, opts] of [['isometric', {}], ['cavalier', {}], ['cabinet', {}], ['oblique', { angleDeg: 20, scale: 0.7 }]]) {
    const { shape, hidden } = setupBox(80, 50, 40, name, opts);
    for (const dim of shape.dimensions) {
      const visible = dim.edges.some(([a, b]) => !hidden.has(`${Math.min(a, b)}_${Math.max(a, b)}`));
      assert.ok(visible, `${name}: "${dim.label}" has no visible candidate edge`);
    }
  }
});

test('polyhedronDimensionItems: a triangular pyramid draws its height as a dashed synthetic segment', () => {
  const shape = triangularPyramid({ sideLength: 60, height: 70 });
  const matrix = matrixOf('isometric');
  const viewDir = viewDirectionOf('isometric');
  const projected = shape.vertices.map((p) => applyMatrix(matrix, p));
  const fit = computeFit(bboxOf(projected), 800, 32);
  const mapped = projected.map(fit.map);
  const project = (v3d) => fit.map(applyMatrix(matrix, v3d));
  const { hidden } = classifyEdges(shape.vertices, shape.faces, shape.edges, viewDir);
  const { items } = polyhedronDimensionItems(shape, mapped, project, hidden, OPTIONS);
  const dashedLines = items.filter((it) => it.type === 'line' && it.dash);
  assert.equal(dashedLines.length, 1, 'exactly the height dimension line is dashed');
  const texts = items.filter((it) => it.type === 'text').map((it) => it.text);
  assert.ok(texts.includes('底面の一辺 60cm'));
  assert.ok(texts.includes('高さ 70cm'));
});

test('curvedDimensionItems: cylinder labels radius and height, both dashed (no matching edge)', () => {
  const shape = cylinder({ radius: 30, height: 70 });
  const matrix = matrixOf('isometric');
  const project = (v3d) => computeFit({ minX: -30, maxX: 30, minY: 0, maxY: 70 }, 800, 32).map(applyMatrix(matrix, v3d));
  const { items, bounds } = curvedDimensionItems('cylinder', shape, project, OPTIONS);
  const texts = items.filter((it) => it.type === 'text').map((it) => it.text).sort();
  assert.deepEqual(texts, ['半径 30cm', '高さ 70cm'].sort());
  assert.equal(items.filter((it) => it.type === 'line' && it.dash).length, 2);
  assert.ok(bounds);
});

test('curvedDimensionItems: cone labels the base radius and height', () => {
  const shape = cone({ radius: 35, height: 70 });
  const matrix = matrixOf('cavalier');
  const project = (v3d) => computeFit({ minX: -35, maxX: 35, minY: 0, maxY: 70 }, 800, 32).map(applyMatrix(matrix, v3d));
  const { items } = curvedDimensionItems('cone', shape, project, OPTIONS);
  const texts = items.filter((it) => it.type === 'text').map((it) => it.text).sort();
  assert.deepEqual(texts, ['底面の半径 35cm', '高さ 70cm'].sort());
});

test('curvedDimensionItems: off (show:false) draws nothing', () => {
  const shape = cylinder({ radius: 30, height: 70 });
  const project = (v3d) => [v3d.x, v3d.y];
  assert.deepEqual(curvedDimensionItems('cylinder', shape, project, { ...OPTIONS, show: false }), { items: [], bounds: null });
});
