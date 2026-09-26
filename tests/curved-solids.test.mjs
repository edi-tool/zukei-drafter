import test from 'node:test';
import assert from 'node:assert/strict';
import { cylinder, cone } from '../js/geometry3d.js';
import { cylinderOutline, coneOutline } from '../js/curved-solids.js';
import { matrixOf, applyMatrix, viewDirectionOf } from '../js/projections.js';
import { ellipsePoint } from '../js/ellipse.js';

const PROJECTIONS = [
  ['isometric', {}],
  ['cavalier', {}],
  ['cabinet', {}],
  ['oblique', { angleDeg: 20, scale: 0.8 }],
];

// Parameter t of a point on the ellipse (the point came from ellipsePoint, so it is exact).
function paramOf(e, p) {
  const [a, b, c, d] = [e.A[0], e.B[0], e.A[1], e.B[1]];
  const det = a * d - b * c;
  const dx = p[0] - e.center[0];
  const dy = p[1] - e.center[1];
  return Math.atan2((-c * dx + a * dy) / det, (d * dx - b * dy) / det);
}

function tangentDir(e, t) {
  return [-e.A[0] * Math.sin(t) + e.B[0] * Math.cos(t), -e.A[1] * Math.sin(t) + e.B[1] * Math.cos(t)];
}

function sinBetween(u, v) {
  return (u[0] * v[1] - u[1] * v[0]) / (Math.hypot(...u) * Math.hypot(...v));
}

for (const [name, options] of PROJECTIONS) {
  const matrix = matrixOf(name, options);
  const viewDir = viewDirectionOf(name, options);

  test(`cylinder (${name}): two silhouette lines, each tangent to both rims`, () => {
    const out = cylinderOutline(cylinder({ radius: 3, height: 8 }), matrix, viewDir);
    assert.equal(out.silhouettes.length, 2);
    for (const [p, q] of out.silhouettes) {
      const line = [q[0] - p[0], q[1] - p[1]];
      for (const [rim, point] of [[out.rims[0], p], [out.rims[1], q]]) {
        const t = paramOf(rim.ellipse, point);
        assert.ok(Math.abs(sinBetween(line, tangentDir(rim.ellipse, t))) < 1e-9, 'silhouette must be tangent');
      }
    }
  });

  test(`cylinder (${name}): top rim fully visible, bottom rim half hidden (front half visible)`, () => {
    const out = cylinderOutline(cylinder({ radius: 3, height: 8 }), matrix, viewDir);
    const [bottom, top] = out.rims;
    assert.deepEqual(top.arcs.map((a) => a.visible), [true]);
    assert.equal(bottom.arcs.length, 2);
    assert.equal(bottom.arcs.filter((a) => a.visible).length, 1);
    for (const arc of bottom.arcs) {
      closeToPi(arc.t1 - arc.t0);
      // The visible (front) half projects lower on the page than the hidden (back) half.
      const mid = ellipsePoint(bottom.ellipse, (arc.t0 + arc.t1) / 2);
      const centerY = bottom.ellipse.center[1];
      assert.equal(arc.visible, mid[1] < centerY);
    }
  });

  test(`cone (${name}): generator lines from the apex are tangent to the base ellipse`, () => {
    const shape = cone({ radius: 3, height: 8 });
    const out = coneOutline(shape, matrix, viewDir);
    const apex = applyMatrix(matrix, shape.apex);
    assert.equal(out.silhouettes.length, 2);
    for (const [p, q] of out.silhouettes) {
      assert.deepEqual(q, apex);
      const t = paramOf(out.rims[0].ellipse, p);
      const line = [apex[0] - p[0], apex[1] - p[1]];
      assert.ok(Math.abs(sinBetween(line, tangentDir(out.rims[0].ellipse, t))) < 1e-9, 'generator must be tangent');
    }
    const visible = out.rims[0].arcs.filter((a) => a.visible);
    assert.equal(visible.length, 1);
    assert.ok(visible[0].t1 - visible[0].t0 > Math.PI, 'more than half of a cone base seen from above is visible');
  });
}

function closeToPi(v) {
  assert.ok(Math.abs(v - Math.PI) < 1e-9, `expected ${v} to be pi`);
}

test('flat cone seen steeply from above: no silhouette, whole base rim visible', () => {
  const out = coneOutline(cone({ radius: 10, height: 1 }), matrixOf('isometric'), viewDirectionOf('isometric'));
  assert.equal(out.silhouettes.length, 0);
  assert.deepEqual(out.rims[0].arcs.map((a) => a.visible), [true]);
});
