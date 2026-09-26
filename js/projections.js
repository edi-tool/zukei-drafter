// Pure 3D -> 2D projection functions. Each projection is a LINEAR map of
// (x, y, z), which is what lets ellipse.js turn a 3D circle into an exact 2D
// ellipse (an affine/linear image of a circle is always an ellipse).
//
// A projection function has the signature (point, options) -> [x2d, y2d].
// `matrixOf(name, options)` exposes the same map as a 2x3 matrix
// [[m00, m01, m02], [m10, m11, m12]] such that
//   x2d = m00*x + m01*y + m02*z
//   y2d = m10*x + m11*y + m12*z
// so that ellipse.js / hidden-line.js can work generically across projections.

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

/** The 2x3 matrix representation of a named projection (see header comment). */
export function matrixOf(name, options = {}) {
  switch (name) {
    case 'isometric': {
      return [
        [ISO_COS30, 0, -ISO_COS30],
        [-0.5, 1, -0.5],
      ];
    }
    case 'cavalier': {
      const rad = deg2rad(options.angleDeg ?? 45);
      return [
        [1, 0, Math.cos(rad)],
        [0, 1, Math.sin(rad)],
      ];
    }
    case 'cabinet': {
      const rad = deg2rad(options.angleDeg ?? 45);
      return [
        [1, 0, 0.5 * Math.cos(rad)],
        [0, 1, 0.5 * Math.sin(rad)],
      ];
    }
    case 'oblique': {
      const rad = deg2rad(options.angleDeg ?? 45);
      const scale = options.scale ?? 0.5;
      return [
        [1, 0, scale * Math.cos(rad)],
        [0, 1, scale * Math.sin(rad)],
      ];
    }
    default:
      throw new RangeError(`unknown projection: ${name}`);
  }
}

export function applyMatrix(matrix, point) {
  const { x, y, z } = point;
  return [
    matrix[0][0] * x + matrix[0][1] * y + matrix[0][2] * z,
    matrix[1][0] * x + matrix[1][1] * y + matrix[1][2] * z,
  ];
}

/** Approximate view direction (object -> camera) used for back-face culling. */
export function viewDirectionOf(name) {
  if (name === 'isometric') {
    const n = 1 / Math.sqrt(3);
    return { x: n, y: n, z: n };
  }
  return { x: 0, y: 0, z: 1 };
}

export function project(name, point, options = {}) {
  return applyMatrix(matrixOf(name, options), point);
}
