import test from 'node:test';
import assert from 'node:assert/strict';
import { regularPolygon } from '../js/geometry2d.js';
import {
  vertexOutwardDirections,
  edgeGeometry,
  interiorAngles,
  isRightAngle,
  vertexLabelLetters,
  formatLength,
  formatAngle,
  pixelsToLogical,
  signedArea,
} from '../js/annotations.js';

function closeTo(actual, expected, eps = 1e-6, msg) {
  assert.ok(Math.abs(actual - expected) <= eps, msg ?? `expected ${actual} to be close to ${expected}, got ${actual}`);
}

test('vertexOutwardDirections: triangle labels point away from the centroid', () => {
  const { points } = regularPolygon({ sides: 3, sideLength: 10 });
  const dirs = vertexOutwardDirections(points, true);
  assert.equal(dirs.length, 3);
  for (let i = 0; i < 3; i++) {
    const [dx, dy] = dirs[i];
    closeTo(Math.hypot(dx, dy), 1, 1e-9, 'direction is a unit vector');
    // Moving outward from the vertex must increase distance from the centroid.
    const c = [0, 0]; // regularPolygon centroid is the origin
    const p = points[i];
    const before = Math.hypot(p[0] - c[0], p[1] - c[1]);
    const moved = [p[0] + dx, p[1] + dy];
    const after = Math.hypot(moved[0] - c[0], moved[1] - c[1]);
    assert.ok(after > before, `vertex ${i} label direction should move away from the shape center`);
  }
});

test('edgeGeometry: square has 4 edges of equal length with outward-pointing normals', () => {
  const points = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const edges = edgeGeometry(points, true);
  assert.equal(edges.length, 4);
  for (const e of edges) closeTo(e.length, 10, 1e-9);
  // Bottom edge (0,0)->(10,0): outward normal should point away from the square, i.e. -y.
  closeTo(edges[0].normal[1], -1, 1e-9);
  // Right edge (10,0)->(10,10): outward normal should point +x.
  closeTo(edges[1].normal[0], 1, 1e-9);
});

test('edgeGeometry: horizontal edge has unit direction (1,0)', () => {
  const edges = edgeGeometry([[0, 0], [5, 0], [5, 5], [0, 5]], true);
  closeTo(edges[0].dir[0], 1, 1e-9);
  closeTo(edges[0].dir[1], 0, 1e-9);
});

test('edgeGeometry: vertical edge has unit direction (0,1)', () => {
  const edges = edgeGeometry([[0, 0], [5, 0], [5, 5], [0, 5]], true);
  closeTo(edges[1].dir[0], 0, 1e-9);
  closeTo(edges[1].dir[1], 1, 1e-9);
});

test('edgeGeometry: diagonal (hypotenuse) edge length matches Pythagoras', () => {
  const points = [[0, 0], [3, 0], [0, 4]];
  const edges = edgeGeometry(points, true);
  const hyp = edges.find((e) => e.a === 1 && e.b === 2);
  closeTo(hyp.length, 5, 1e-9);
});

test('interiorAngles: equilateral triangle has three 60 degree angles', () => {
  const { points } = regularPolygon({ sides: 3, sideLength: 10 });
  const angles = interiorAngles(points);
  assert.equal(angles.length, 3);
  for (const a of angles) closeTo(a.angleDeg, 60, 1e-6);
});

test('interiorAngles: square has four 90 degree angles, all right angles', () => {
  const points = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const angles = interiorAngles(points);
  for (const a of angles) {
    closeTo(a.angleDeg, 90, 1e-6);
    assert.ok(isRightAngle(a.angleDeg));
  }
});

test('interiorAngles: regular hexagon has six 120 degree angles', () => {
  const { points } = regularPolygon({ sides: 6, sideLength: 10 });
  const angles = interiorAngles(points);
  for (const a of angles) closeTo(a.angleDeg, 120, 1e-6);
});

test('interiorAngles: works for clockwise winding too (angle magnitude unaffected)', () => {
  const ccw = [[0, 0], [10, 0], [10, 10], [0, 10]];
  const cw = [...ccw].reverse();
  assert.ok(signedArea(ccw) > 0);
  assert.ok(signedArea(cw) < 0);
  const anglesCcw = interiorAngles(ccw).map((a) => a.angleDeg).sort();
  const anglesCw = interiorAngles(cw).map((a) => a.angleDeg).sort();
  anglesCcw.forEach((a, i) => closeTo(a, anglesCw[i], 1e-6));
});

test('interiorAngles: sum of a polygon\'s interior angles is (n-2)*180', () => {
  const { points } = regularPolygon({ sides: 5, sideLength: 10 });
  const angles = interiorAngles(points);
  const sum = angles.reduce((acc, a) => acc + a.angleDeg, 0);
  closeTo(sum, (5 - 2) * 180, 1e-6);
});

test('isRightAngle: exact 90 degrees is a right angle', () => {
  assert.ok(isRightAngle(90));
});

test('isRightAngle: within epsilon of 90 degrees still counts (floating point tolerance)', () => {
  assert.ok(isRightAngle(90.0000003));
  assert.ok(isRightAngle(89.9999997));
});

test('isRightAngle: 89 degrees is not a right angle at the default epsilon', () => {
  assert.ok(!isRightAngle(89));
});

test('isRightAngle: 60 and 120 degrees are not right angles', () => {
  assert.ok(!isRightAngle(60));
  assert.ok(!isRightAngle(120));
});

test('vertexLabelLetters: A, B, C, ... for the first 26, then AA, AB, ...', () => {
  const letters = vertexLabelLetters(28);
  assert.equal(letters[0], 'A');
  assert.equal(letters[1], 'B');
  assert.equal(letters[25], 'Z');
  assert.equal(letters[26], 'AA');
  assert.equal(letters[27], 'AB');
});

test('formatLength: unit conversion (mm/cm) and "no unit" pass-through', () => {
  assert.equal(formatLength(50, 'none', 0), '50');
  assert.equal(formatLength(50, 'mm', 0), '50 mm');
  assert.equal(formatLength(50, 'cm', 0), '5 cm');
  assert.equal(formatLength(12.5, 'mm', 1), '12.5 mm');
});

test('formatLength: decimal place formatting rounds to the requested precision', () => {
  assert.equal(formatLength(33.336, 'none', 2), '33.34');
  assert.equal(formatLength(33.336, 'none', 0), '33');
  assert.equal(formatLength(1, 'cm', 2), '0.10 cm');
});

test('formatAngle: appends the degree sign and respects decimals', () => {
  assert.equal(formatAngle(60, 0), '60°');
  assert.equal(formatAngle(59.995, 1), '60.0°');
});

test('pixelsToLogical: converts a pixel-space offset into logical units via the fit scale', () => {
  closeTo(pixelsToLogical(20, 4), 5, 1e-9);
  closeTo(pixelsToLogical(0, 4), 0, 1e-9);
});
