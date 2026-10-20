import test from 'node:test';
import assert from 'node:assert/strict';
import { rectangle, parallelogram, trapezoid, sector, arcBBox, triangleMeasures } from '../js/geometry2d.js';

const close = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b}`);
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

test('rectangle: sides and right angles, bottom edge horizontal', () => {
  const { ok, points } = rectangle({ width: 60, height: 40 });
  assert.ok(ok);
  assert.deepEqual(points, [[0, 0], [60, 0], [60, 40], [0, 40]]);
  assert.equal(rectangle({ width: 0, height: 40 }).ok, false);
  assert.equal(rectangle({ width: 10, height: NaN }).ok, false);
});

test('parallelogram: opposite sides equal and parallel, angle A as given', () => {
  const { ok, points } = parallelogram({ base: 60, side: 40, angleDeg: 60 });
  assert.ok(ok);
  const [A, B, C, D] = points;
  close(dist(A, B), 60);
  close(dist(C, D), 60);
  close(dist(A, D), 40);
  close(dist(B, C), 40);
  close(triangleMeasures([A, B, D]).angles.A, 60);
  for (const bad of [{ angleDeg: 0 }, { angleDeg: 180 }, { side: -1 }]) {
    assert.equal(parallelogram({ base: 60, side: 40, angleDeg: 60, ...bad }).ok, false);
  }
});

test('trapezoid: parallel bases with the given lengths, height and offset', () => {
  const { ok, points } = trapezoid({ bottom: 80, top: 40, height: 30, offset: -5 });
  assert.ok(ok);
  const [A, B, C, D] = points;
  close(dist(A, B), 80);
  close(dist(D, C), 40);
  assert.equal(C[1], 30);
  assert.equal(D[1], 30);
  assert.equal(D[0], -5);
  assert.equal(trapezoid({ bottom: 80, top: 0, height: 30, offset: 0 }).ok, false);
  assert.equal(trapezoid({ bottom: 80, top: 40, height: 30, offset: NaN }).ok, false);
});

test('sector: radii of the given length, central angle, symmetric about the vertical axis', () => {
  const s = sector({ radius: 50, angleDeg: 120 });
  assert.ok(s.ok);
  const [A, O, B] = s.points;
  assert.deepEqual(O, [0, 0]);
  close(dist(A, O), 50);
  close(dist(B, O), 50);
  close(s.endDeg - s.startDeg, 120);
  close(A[0], -B[0]);
  close(A[1], B[1]);
  for (const angleDeg of [0, 360, -10, NaN]) assert.equal(sector({ radius: 50, angleDeg }).ok, false);
  assert.equal(sector({ radius: 0, angleDeg: 90 }).ok, false);
});

test('arcBBox includes the axis extremes the arc passes', () => {
  assert.deepEqual(arcBBox([0, 0], 1, 0, 360), { minX: -1, maxX: 1, minY: -1, maxY: 1 });
  const b = arcBBox([0, 0], 2, 45, 135);
  close(b.maxY, 2);
  close(b.minX, -Math.SQRT2);
  close(b.maxX, Math.SQRT2);
  close(b.minY, Math.SQRT2);
  // Negative angles (the cone net's sector hangs below its apex).
  close(arcBBox([0, 0], 1, -150, -30).minY, -1);
});
