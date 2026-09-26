import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCircle, ellipsePoint, ellipseBBox, ellipseArcBeziers } from '../js/ellipse.js';
import { matrixOf, applyMatrix } from '../js/projections.js';

const Y_AXIS = { x: 0, y: 1, z: 0 };

function closeTo(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${actual} to be close to ${expected}`);
}

function bezierPoint([p0, p1, p2, p3], s) {
  const m = 1 - s;
  const w = [m * m * m, 3 * m * m * s, 3 * m * s * s, s * s * s];
  return [0, 1].map((k) => w[0] * p0[k] + w[1] * p1[k] + w[2] * p2[k] + w[3] * p3[k]);
}

// Distance from p to the ellipse, measured in the ellipse's own (unit-circle) coordinates.
function unitCircleResidual(e, p) {
  const [a, b, c, d] = [e.A[0], e.B[0], e.A[1], e.B[1]];
  const det = a * d - b * c;
  const dx = p[0] - e.center[0];
  const dy = p[1] - e.center[1];
  return Math.hypot((d * dx - b * dy) / det, (-c * dx + a * dy) / det) - 1;
}

for (const name of ['isometric', 'cavalier', 'cabinet']) {
  test(`projectCircle (${name}): every projected 3D circle point equals the parametric ellipse point`, () => {
    const matrix = matrixOf(name);
    const center = { x: 1, y: 2, z: -3 };
    const e = projectCircle(matrix, center, 5, Y_AXIS);
    for (let i = 0; i < 24; i++) {
      const t = (2 * Math.PI * i) / 24;
      const p3 = {
        x: center.x + 5 * (Math.cos(t) * e.u.x + Math.sin(t) * e.w.x),
        y: center.y + 5 * (Math.cos(t) * e.u.y + Math.sin(t) * e.w.y),
        z: center.z + 5 * (Math.cos(t) * e.u.z + Math.sin(t) * e.w.z),
      };
      assert.ok(Math.abs(p3.y - center.y) < 1e-12, 'circle must lie in the plane perpendicular to the axis');
      const [x, y] = applyMatrix(matrix, p3);
      const [ex, ey] = ellipsePoint(e, t);
      closeTo(x, ex);
      closeTo(y, ey);
    }
  });
}

test('ellipseBBox is tight: all samples inside and the extremes are reached', () => {
  const e = projectCircle(matrixOf('isometric'), { x: 0, y: 0, z: 0 }, 3, Y_AXIS);
  const box = ellipseBBox(e);
  let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
  for (let i = 0; i < 20000; i++) {
    const [x, y] = ellipsePoint(e, (2 * Math.PI * i) / 20000);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (const [got, want] of [[minX, box.minX], [maxX, box.maxX], [minY, box.minY], [maxY, box.maxY]]) {
    closeTo(got, want, 1e-6);
  }
});

test('ellipseArcBeziers: curves stay on the ellipse (< 0.03% of radius) and endpoints are exact', () => {
  const e = projectCircle(matrixOf('cabinet'), { x: 0, y: 0, z: 0 }, 10, Y_AXIS);
  const t0 = 0.3;
  const t1 = 0.3 + 1.7 * Math.PI;
  const segments = ellipseArcBeziers(e, t0, t1);
  assert.equal(segments.length, 4);
  closeTo(segments[0][0][0], ellipsePoint(e, t0)[0]);
  closeTo(segments.at(-1)[3][1], ellipsePoint(e, t1)[1]);
  for (const seg of segments) {
    for (let k = 0; k <= 20; k++) {
      assert.ok(Math.abs(unitCircleResidual(e, bezierPoint(seg, k / 20))) < 3e-4);
    }
  }
});
