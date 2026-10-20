import test from 'node:test';
import assert from 'node:assert/strict';
import { hatchSegments } from '../js/hatch.js';
import { pointInPolygon } from '../js/annotations.js';

const square = [[0, 0], [100, 0], [100, 100], [0, 100]];

test('hatch lines are parallel at the requested angle and spacing', () => {
  const segs = hatchSegments(square, 10, 45);
  assert.ok(segs.length > 10);
  for (const [p, q] of segs) {
    // 45° counter-clockwise on the page = up and to the right in y-down px.
    const angle = (Math.atan2(-(q[1] - p[1]), q[0] - p[0]) * 180) / Math.PI;
    assert.ok(Math.abs(Math.abs(angle) - 45) < 1e-6 || Math.abs(Math.abs(angle) - 135) < 1e-6, `angle ${angle}`);
  }
  // Distance between neighbouring lines along the normal is the spacing.
  const offsets = segs.map(([p]) => (p[0] + p[1]) / Math.SQRT2).sort((a, b) => a - b);
  for (let i = 1; i < offsets.length; i++) assert.ok(Math.abs(offsets[i] - offsets[i - 1] - 10) < 1e-6);
});

test('hatch segments stay inside the polygon, also a non-convex one', () => {
  const ell = [[0, 0], [100, 0], [100, 40], [40, 40], [40, 100], [0, 100]];
  const segs = hatchSegments(ell, 7, 45);
  assert.ok(segs.length > 0);
  for (const [p, q] of segs) {
    for (const t of [0.01, 0.25, 0.5, 0.75, 0.99]) {
      const pt = [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
      assert.ok(pointInPolygon(pt, ell), `${pt} outside`);
    }
  }
});

test('degenerate input gives no hatch', () => {
  assert.deepEqual(hatchSegments([[0, 0], [1, 1]], 5), []);
  assert.deepEqual(hatchSegments(square, 0), []);
});
