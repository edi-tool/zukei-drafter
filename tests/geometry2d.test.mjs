import test from 'node:test';
import assert from 'node:assert/strict';
import {
  regularPolygon,
  triangleFromSSS,
  triangleFromSAS,
  triangleFromASA,
  generalPolygon,
  EPSILON,
} from '../js/geometry2d.js';

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function closeTo(actual, expected, eps = 1e-6, msg) {
  assert.ok(Math.abs(actual - expected) <= eps, msg ?? `expected ${actual} to be close to ${expected}`);
}

test('regular polygon: equilateral triangle has equal sides', () => {
  const { points } = regularPolygon({ sides: 3, sideLength: 10 });
  assert.equal(points.length, 3);
  const sides = [dist(points[0], points[1]), dist(points[1], points[2]), dist(points[2], points[0])];
  for (const s of sides) closeTo(s, 10, 1e-9);
});

test('regular polygon: square has equal sides and right angles', () => {
  const { points } = regularPolygon({ sides: 4, sideLength: 5 });
  assert.equal(points.length, 4);
  const sides = [0, 1, 2, 3].map((i) => dist(points[i], points[(i + 1) % 4]));
  for (const s of sides) closeTo(s, 5, 1e-9);
  // diagonal should be side * sqrt(2)
  closeTo(dist(points[0], points[2]), 5 * Math.SQRT2, 1e-9);
});

test('regular polygon: regular hexagon has equal sides and circumradius == side length', () => {
  const { points } = regularPolygon({ sides: 6, sideLength: 8 });
  assert.equal(points.length, 6);
  const sides = points.map((p, i) => dist(p, points[(i + 1) % 6]));
  for (const s of sides) closeTo(s, 8, 1e-9);
  for (const p of points) closeTo(Math.hypot(p[0], p[1]), 8, 1e-9);
});

test('regular polygon: rejects invalid vertex counts', () => {
  assert.throws(() => regularPolygon({ sides: 2, sideLength: 1 }));
});

test('triangle SSS: valid triangle reproduces given side lengths (a=AB, b=AC, c=BC)', () => {
  const result = triangleFromSSS({ a: 3, b: 4, c: 5 });
  assert.ok(result.ok);
  const [A, B, C] = result.points;
  closeTo(dist(A, B), 3, 1e-9);
  closeTo(dist(A, C), 4, 1e-9);
  closeTo(dist(B, C), 5, 1e-9);
});

test('triangle SAS: reproduces both sides and the included angle', () => {
  const result = triangleFromSAS({ sideA: 6, angleC: 60, sideB: 7 });
  assert.ok(result.ok);
  const [A, B, C] = result.points;
  closeTo(dist(A, B), 6, 1e-9);
  closeTo(dist(A, C), 7, 1e-9);
  const v1 = [B[0] - A[0], B[1] - A[1]];
  const v2 = [C[0] - A[0], C[1] - A[1]];
  const cosAngle = (v1[0] * v2[0] + v1[1] * v2[1]) / (dist(A, B) * dist(A, C));
  closeTo((Math.acos(cosAngle) * 180) / Math.PI, 60, 1e-6);
});

test('triangle ASA: reproduces the side and both adjacent angles', () => {
  const result = triangleFromASA({ side: 10, angleA: 50, angleB: 60 });
  assert.ok(result.ok);
  const [A, B, C] = result.points;
  closeTo(dist(A, B), 10, 1e-9);
  function angleAt(P, Q, R) {
    const v1 = [Q[0] - P[0], Q[1] - P[1]];
    const v2 = [R[0] - P[0], R[1] - P[1]];
    const cosA = (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2));
    return (Math.acos(cosA) * 180) / Math.PI;
  }
  closeTo(angleAt(A, B, C), 50, 1e-6);
  closeTo(angleAt(B, A, C), 60, 1e-6);
});

test('triangle: degenerate/impossible inputs are rejected', () => {
  assert.equal(triangleFromSSS({ a: 1, b: 1, c: 10 }).ok, false);
  assert.equal(triangleFromASA({ side: 10, angleA: 100, angleB: 100 }).ok, false);
  assert.equal(triangleFromSAS({ sideA: 5, angleC: 200, sideB: 5 }).ok, false);
});

test('general polygon: a properly closed quadrilateral reports closed=true', () => {
  // A 4x3 rectangle traversed with absolute heading angles.
  const result = generalPolygon({ lengths: [4, 3, 4, 3], headingsDeg: [0, 90, 180, 270] });
  assert.equal(result.closed, true);
  assert.ok(result.closureError <= EPSILON);
  assert.equal(result.points.length, 4);
});

test('general polygon: a non-closing path reports closed=false with a meaningful error', () => {
  const result = generalPolygon({ lengths: [4, 3, 4, 2], headingsDeg: [0, 90, 180, 270] });
  assert.equal(result.closed, false);
  closeTo(result.closureError, 1, 1e-9);
});
