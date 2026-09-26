import test from 'node:test';
import assert from 'node:assert/strict';
import { cube, quadrangularPyramid, triangularPrism } from '../js/geometry3d.js';
import { classifyEdges } from '../js/hidden-line.js';
import { viewDirectionOf } from '../js/projections.js';

// Edges touching the vertex that is farthest from the viewer.
function edgesAtFarthestVertex(shape, viewDir) {
  let far = 0;
  shape.vertices.forEach((p, i) => {
    const q = shape.vertices[far];
    if (p.x * viewDir.x + p.y * viewDir.y + p.z * viewDir.z < q.x * viewDir.x + q.y * viewDir.y + q.z * viewDir.z) far = i;
  });
  return new Set(shape.edges.filter((e) => e.a === far || e.b === far).map((e) => `${e.a}_${e.b}`));
}

for (const [projection, options] of [
  ['isometric', {}],
  ['cavalier', {}],
  ['cabinet', {}],
  ['oblique', { angleDeg: 30, scale: 0.7 }],
  ['oblique', { angleDeg: 150, scale: 0.5 }],
]) {
  test(`cube in ${projection} ${JSON.stringify(options)}: exactly the 3 edges at the far corner are hidden`, () => {
    const shape = cube({ size: 10 });
    const viewDir = viewDirectionOf(projection, options);
    const { hidden } = classifyEdges(shape.vertices, shape.faces, shape.edges, viewDir);
    assert.deepEqual(hidden, edgesAtFarthestVertex(shape, viewDir));
  });
}

test('cabinet cube: front (-z), top and right faces are the visible ones', () => {
  const shape = cube({ size: 10 });
  const { frontFaces } = classifyEdges(shape.vertices, shape.faces, shape.edges, viewDirectionOf('cabinet'));
  // Face order in geometry3d.box: bottom, top, -Z, +X, +Z, -X
  assert.deepEqual(frontFaces, [false, true, true, true, false, false]);
});

test('square pyramid in cabinet: the 3 edges at the far base corner are hidden (2 base + 1 lateral)', () => {
  const shape = quadrangularPyramid({ baseWidth: 10, height: 10 });
  const viewDir = viewDirectionOf('cabinet');
  const { hidden } = classifyEdges(shape.vertices, shape.faces, shape.edges, viewDir);
  assert.deepEqual(hidden, edgesAtFarthestVertex(shape, viewDir));
  assert.equal(hidden.size, 3);
});

test('triangular prism in isometric: a closed convex solid always shows some hidden edges', () => {
  const shape = triangularPrism({ sideLength: 10, height: 10 });
  const { hidden, visible } = classifyEdges(shape.vertices, shape.faces, shape.edges, viewDirectionOf('isometric'));
  assert.ok(hidden.size > 0 && visible.size > hidden.size);
});

test('viewing straight down +Y: edge-on side faces count as back-facing', () => {
  const shape = cube({ size: 10 });
  const { hidden, visible } = classifyEdges(shape.vertices, shape.faces, shape.edges, { x: 0, y: 1, z: 0 });
  assert.equal(visible.size, 4);
  assert.equal(hidden.size, 8);
});
