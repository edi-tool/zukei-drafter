// Pure 3D -> 2D projection functions. Each projection is a LINEAR map of
// (x, y, z), which is what lets ellipse.js turn a 3D circle into an exact 2D
// ellipse (an affine/linear image of a circle is always an ellipse).
//
// A projection function has the signature (point, options) -> [x2d, y2d].
// `matrixOf(name, options)` exposes the same map as a 2x3 matrix
// [[m00, m01, m02], [m10, m11, m12]] such that
//   x2d = m00*x + m01*y + m02*z
//   y2d = m10*x + m11*y + m12*z
// so that ellipse.js / curved-solids.js can work generically across projections.

function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

// Standard isometric axonometry: the X, Y, Z basis vectors are drawn as unit
// vectors 120 degrees apart on the page (Y straight up, X to the lower-right,
// Z to the lower-left). This is the classic closed-form isometric formula
// (equivalent to, but simpler than, driving it via two 3D rotations).
const ISO_COS30 = Math.cos(deg2rad(30));

export function projectIsometric(point) {
  const { x, y, z } = point;
  const x2d = ISO_COS30 * (x - z);
  const y2d = y - 0.5 * (x + z);
  return [x2d, y2d];
}

export function projectOblique(point, { angleDeg = 45, scale = 0.5 } = {}) {
  const { x, y, z } = point;
  const rad = deg2rad(angleDeg);
  const x2d = x + z * scale * Math.cos(rad);
  const y2d = y + z * scale * Math.sin(rad);
  return [x2d, y2d];
}

export function projectCavalier(point, options = {}) {
  return projectOblique(point, { angleDeg: options.angleDeg ?? 45, scale: 1 });
}

export function projectCabinet(point, options = {}) {
  return projectOblique(point, { angleDeg: options.angleDeg ?? 45, scale: 0.5 });
}

function obliqueParams(name, options) {
  const angleDeg = options.angleDeg ?? 45;
  switch (name) {
    case 'cavalier':
      return { angleDeg, scale: 1 };
    case 'cabinet':
      return { angleDeg, scale: 0.5 };
    case 'oblique':
      return { angleDeg, scale: options.scale ?? 0.5 };
    default:
      throw new RangeError(`unknown projection: ${name}`);
  }
}

/** The 2x3 matrix representation of a named projection (see header comment). */
export function matrixOf(name, options = {}) {
  if (name === 'isometric') {
    return [
      [ISO_COS30, 0, -ISO_COS30],
      [-0.5, 1, -0.5],
    ];
  }
  const { angleDeg, scale } = obliqueParams(name, options);
  const rad = deg2rad(angleDeg);
  return [
    [1, 0, scale * Math.cos(rad)],
    [0, 1, scale * Math.sin(rad)],
  ];
}

export function applyMatrix(matrix, point) {
  const { x, y, z } = point;
  return [
    matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z,
    matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z,
  ];
}

/**
 * Unit vector from the object toward the viewer, along the projectors: it
 * spans the null space of the projection matrix, so every point on a line
 * with this direction lands on the same 2D point. This makes back-face tests
 * and curved-surface silhouettes exact, not approximate.
 * Isometric looks from (+1, +1, +1). The oblique family keeps the x-y plane
 * as the true-size picture plane nearest the viewer, so the viewer is on -z.
 */
export function viewDirectionOf(name, options = {}) {
  if (name === 'isometric') {
    const n = 1 / Math.sqrt(3);
    return { x: n, y: n, z: n };
  }
  const { angleDeg, scale } = obliqueParams(name, options);
  const rad = deg2rad(angleDeg);
  const d = { x: scale * Math.cos(rad), y: scale * Math.sin(rad), z: -1 };
  const len = Math.hypot(d.x, d.y, d.z);
  return { x: d.x / len, y: d.y / len, z: d.z / len };
}
