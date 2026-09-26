// Approximate hidden-line detection for convex-ish polyhedra: classify each
// face as front- or back-facing relative to an approximate view direction,
// then mark an edge hidden only if none of its owning faces are front-facing.
// This is intentionally not a general/exact 3D visibility algorithm (see
// ARCHITECTURE.md) -- it is sufficient for the supported primitives.

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(p, q) {
  return {
    x: p.y * q.z - p.z * q.y,
    y: p.z * q.x - p.x * q.z,
    z: p.x * q.y - p.y * q.x,
  };
}

function dot(p, q) {
  return p.x * q.x + p.y * q.y + p.z * q.z;
}

export function faceNormal(vertices, face) {
  const a = vertices[face[0]];
  const b = vertices[face[1]];
  const c = vertices[face[2]];
  return cross(sub(b, a), sub(c, a));
}

/**
 * @returns {{visible: Set<string>, hidden: Set<string>, frontFaces: boolean[]}}
 *   edges keyed by "min_max" vertex index pair, matching geometry3d edge shape.
 */
export function classifyEdges(vertices, faces, edges, viewDir) {
  const frontFaces = faces.map((face) => dot(faceNormal(vertices, face), viewDir) > 0);
  const visible = new Set();
  const hidden = new Set();
  for (const edge of edges) {
    const key = `${edge.a}_${edge.b}`;
    const anyFront = edge.faces.some((fi) => frontFaces[fi]);
    if (anyFront) visible.add(key);
    else hidden.add(key);
  }
  return { visible, hidden, frontFaces };
}
