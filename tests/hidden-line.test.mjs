import test from 'node:test';
import assert from 'node:assert/strict';
import { cube } from '../js/geometry3d.js';
import { classifyEdges } from '../js/hidden-line.js';

test('hidden-line: viewing a cube from a corner hides exactly the 3 far edges', () => {
  const shape = cube({ size: 10 });
  // Looking from (1,1,1): the far corner (-5,-5,-5)-ish vertex has 3 hidden edges.
  const viewDir = { x: 1, y: 1, z: 1 };
  const { hidden, visible } = classifyEdges(shape.vertices, shape.faces, shape.edges, viewDir);
  assert.equal(hidden.size, 3);
  assert.equal(visible.size, shape.edges.length - 3);
});

test('hidden-line: viewing straight down +Y hides the bottom face and vertical edges (edge-on side faces count as back-facing)', () => {
  const shape = cube({ size: 10 });
  const viewDir = { x: 0, y: 1, z: 0 };
  const { hidden, visible } = classifyEdges(shape.vertices, shape.faces, shape.edges, viewDir);
  // Only the 4 top edges are shared with the (front-facing) top face; the 4
  // bottom edges and 4 vertical edges are only ever shared with back-facing
  // or edge-on side faces, so they are classified hidden.
  assert.equal(visible.size, 4);
  assert.equal(hidden.size, 8);
});
