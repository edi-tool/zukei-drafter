import test from 'node:test';
import assert from 'node:assert/strict';
import { projectIsometric, projectCavalier, projectCabinet, projectOblique, matrixOf, applyMatrix } from '../js/projections.js';

function closeTo(actual, expected, eps = 1e-9) {
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${actual} to be close to ${expected}`);
}

test('isometric projection: the three cube edges from the origin have equal length and are 120 degrees apart', () => {
  const origin = projectIsometric({ x: 0, y: 0, z: 0 });
  const px = projectIsometric({ x: 1, y: 0, z: 0 });
  const py = projectIsometric({ x: 0, y: 1, z: 0 });
  const pz = projectIsometric({ x: 0, y: 0, z: 1 });
  const vx = [px[0] - origin[0], px[1] - origin[1]];
  const vy = [py[0] - origin[0], py[1] - origin[1]];
  const vz = [pz[0] - origin[0], pz[1] - origin[1]];
  const lx = Math.hypot(...vx);
  const ly = Math.hypot(...vy);
  const lz = Math.hypot(...vz);
  closeTo(lx, ly, 1e-9);
  closeTo(ly, lz, 1e-9);

  function angleBetween(a, b) {
    const cos = (a[0] * b[0] + a[1] * b[1]) / (Math.hypot(...a) * Math.hypot(...b));
    return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
  }
  closeTo(angleBetween(vx, vy), 120, 1e-6);
  closeTo(angleBetween(vy, vz), 120, 1e-6);
});

test('isometric projection is linear (matrixOf matches the direct function)', () => {
  const p = { x: 3, y: -2, z: 5 };
  const [x1, y1] = projectIsometric(p);
  const [x2, y2] = applyMatrix(matrixOf('isometric'), p);
  closeTo(x1, x2);
  closeTo(y1, y2);
});

test('cavalier projection: front face (z=0) is drawn true size and unrotated', () => {
  const p = projectCavalier({ x: 5, y: 7, z: 0 });
  closeTo(p[0], 5);
  closeTo(p[1], 7);
});

test('cavalier projection: depth axis is drawn at full scale along the given angle', () => {
  const [x, y] = projectCavalier({ x: 0, y: 0, z: 10 }, { angleDeg: 45 });
  closeTo(x, 10 * Math.cos(Math.PI / 4));
  closeTo(y, 10 * Math.sin(Math.PI / 4));
});

test('cabinet projection: depth axis is drawn at half scale', () => {
  const [x, y] = projectCabinet({ x: 0, y: 0, z: 10 }, { angleDeg: 45 });
  closeTo(x, 5 * Math.cos(Math.PI / 4));
  closeTo(y, 5 * Math.sin(Math.PI / 4));
});

test('oblique projection: generalizes cavalier/cabinet via arbitrary angle+scale', () => {
  const [x, y] = projectOblique({ x: 1, y: 2, z: 4 }, { angleDeg: 30, scale: 0.7 });
  closeTo(x, 1 + 4 * 0.7 * Math.cos(Math.PI / 6));
  closeTo(y, 2 + 4 * 0.7 * Math.sin(Math.PI / 6));
});
