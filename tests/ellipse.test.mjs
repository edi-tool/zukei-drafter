import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCircleToEllipse, tangentPointsFromExternalPoint } from '../js/ellipse.js';
import { matrixOf, applyMatrix } from '../js/projections.js';

function closeTo(actual, expected, eps = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${actual} to be close to ${expected}`);
}

function ellipsePoint(e, t) {
  const rad = (e.rotationDeg * Math.PI) / 180;
  const lx = e.rx * Math.cos(t);
  const ly = e.ry * Math.sin(t);
  return [e.cx + lx * Math.cos(rad) - ly * Math.sin(rad), e.cy + lx * Math.sin(rad) + ly * Math.cos(rad)];
}

test('projectCircleToEllipse: sampled 3D circle points lie exactly on the derived ellipse (cavalier)', () => {
  const matrix = matrixOf('cavalier', { angleDeg: 45 });
  const center = { x: 0, y: 0, z: 0 };
  const radius = 3;
  const axis = { x: 0, y: 1, z: 0 };
  const ellipse = projectCircleToEllipse(matrix, center, radius, axis);

  for (let i = 0; i < 16; i++) {
    const t = (2 * Math.PI * i) / 16;
    const point3d = {
      x: radius * Math.cos(t),
      y: 0,
      z: radius * Math.sin(t),
    };
    const projected = applyMatrix(matrix, point3d);
    // Find the closest point on the derived ellipse by scanning; since the
    // ellipse is the exact image of the circle, some parameter must match
    // the projected point almost exactly.
    let best = Infinity;
    for (let j = 0; j < 720; j++) {
      const et = (2 * Math.PI * j) / 720;
      const ep = ellipsePoint(ellipse, et);
      const d = Math.hypot(ep[0] - projected[0], ep[1] - projected[1]);
      if (d < best) best = d;
    }
    assert.ok(best < 1e-3, `projected circle point should lie on the derived ellipse (min dist ${best})`);
  }
});

test('projectCircleToEllipse: isometric projection of a horizontal circle keeps it centered correctly', () => {
  const matrix = matrixOf('isometric');
  const ellipse = projectCircleToEllipse(matrix, { x: 0, y: 5, z: 0 }, 2, { x: 0, y: 1, z: 0 });
  const centerProjected = applyMatrix(matrix, { x: 0, y: 5, z: 0 });
  closeTo(ellipse.cx, centerProjected[0]);
  closeTo(ellipse.cy, centerProjected[1]);
  assert.ok(ellipse.rx > 0 && ellipse.ry > 0);
});

test('tangentPointsFromExternalPoint: tangent lines from an external point touch the ellipse', () => {
  const ellipse = { cx: 0, cy: 0, rx: 4, ry: 2, rotationDeg: 0 };
  const apex = [10, 10];
  const [t1, t2] = tangentPointsFromExternalPoint(ellipse, apex);
  for (const [x, y] of [t1, t2]) {
    const value = (x / ellipse.rx) ** 2 + (y / ellipse.ry) ** 2;
    closeTo(value, 1, 1e-6);
  }
});

test('tangentPointsFromExternalPoint: returns null for a point inside the ellipse', () => {
  const ellipse = { cx: 0, cy: 0, rx: 4, ry: 2, rotationDeg: 0 };
  assert.equal(tangentPointsFromExternalPoint(ellipse, [0, 0]), null);
});
