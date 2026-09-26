import test from 'node:test';
import assert from 'node:assert/strict';
import * as g from '../js/geometry3d.js';
import { faceNormal } from '../js/hidden-line.js';

const POLYHEDRA = {
  cube: g.cube({ size: 10 }),
  box: g.box({ width: 8, height: 5, depth: 3 }),
  triangularPrism: g.triangularPrism({ sideLength: 6, height: 9 }),
  quadrangularPrism: g.quadrangularPrism({ width: 6, depth: 6, height: 9 }),
  triangularPyramid: g.triangularPyramid({ sideLength: 6, height: 7 }),
  quadrangularPyramid: g.quadrangularPyramid({ baseWidth: 6, height: 7 }),
};

function centroid(points) {
  const n = points.length;
  return points.reduce((c, p) => ({ x: c.x + p.x / n, y: c.y + p.y / n, z: c.z + p.z / n }), { x: 0, y: 0, z: 0 });
}

for (const [name, shape] of Object.entries(POLYHEDRA)) {
  test(`${name}: every face normal points outward`, () => {
    const center = centroid(shape.vertices);
    for (const face of shape.faces) {
      const n = faceNormal(shape.vertices, face);
      const fc = centroid(face.map((i) => shape.vertices[i]));
      const outward = n.x * (fc.x - center.x) + n.y * (fc.y - center.y) + n.z * (fc.z - center.z);
      assert.ok(outward > 0, `face ${face} is wound inward`);
    }
  });

  test(`${name}: closed surface (Euler V - E + F = 2, every edge shared by 2 faces)`, () => {
    assert.equal(shape.vertices.length - shape.edges.length + shape.faces.length, 2);
    assert.ok(shape.edges.every((e) => e.faces.length === 2));
  });
}

test('quadrangular pyramid base is an axis-aligned square with the given side', () => {
  const { vertices } = POLYHEDRA.quadrangularPyramid;
  const base = vertices.slice(0, 4);
  for (let i = 0; i < 4; i++) {
    const p = base[i];
    const q = base[(i + 1) % 4];
    assert.ok(Math.abs(Math.hypot(q.x - p.x, q.z - p.z) - 6) < 1e-9);
    assert.ok(Math.abs(p.x - q.x) < 1e-9 || Math.abs(p.z - q.z) < 1e-9, 'edge is axis-aligned');
  }
});

test('triangular prism base is equilateral with the given side and the height is respected', () => {
  const { vertices } = POLYHEDRA.triangularPrism;
  for (let i = 0; i < 3; i++) {
    const p = vertices[i];
    const q = vertices[(i + 1) % 3];
    assert.ok(Math.abs(Math.hypot(q.x - p.x, q.z - p.z) - 6) < 1e-9);
    assert.equal(vertices[i + 3].y, 9);
  }
});
