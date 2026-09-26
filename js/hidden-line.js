// Hidden-line classification for convex polyhedra: a face is front-facing
// when its outward normal points toward the viewer (along the exact
// projection direction from projections.viewDirectionOf), and an edge is
// hidden only if none of its owning faces are front-facing. This is exact for
// convex solids, which covers every supported polyhedron; concave or
// multi-object scenes would need a real occlusion algorithm.

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

/** Unit outward normal (faces are wound counter-clockwise seen from outside). */
export function faceNormal(vertices, face) {
  const a = vertices[face[0]];
  const n = cross(sub(vertices[face[1]], a), sub(vertices[face[2]], a));
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: n.x / len, y: n.y / len, z: n.z / len };
}

// Edge-on faces (dot ~ 0) count as back-facing; the tolerance keeps rounding
// noise from flipping them.
const FRONT_EPS = 1e-9;

/**
 * @returns {{visible: Set<string>, hidden: Set<string>, frontFaces: boolean[]}}
 *   edges keyed by "min_max" vertex index pair, matching geometry3d edge shape.
 */
export function classifyEdges(vertices, faces, edges, viewDir) {
  const frontFaces = faces.map((face) => dot(faceNormal(vertices, face), viewDir) > FRONT_EPS);
  const visible = new Set();
  const hidden = new Set();
  for (const edge of edges) {
    const key = `${edge.a}_${edge.b}`;
    if (edge.faces.some((fi) => frontFaces[fi])) visible.add(key);
    else hidden.add(key);
  }
  return { visible, hidden, frontFaces };
}
