// Nets (展開図) of solids as flat 2D data, in logical units (y up). Pure
// functions: no DOM access, so this module is unit-testable under Node.
//
// A net is { faces, lines, circles, sectors, dims, angle? }:
//   faces    polygons covering the paper (fill regions; circles/sectors fill themselves)
//   lines    straight edges { p, q, fold } — fold: shared by two faces (折り目)
//   circles  { center, radius }
//   sectors  { center, radius, startDeg, endDeg } (arc counter-clockwise start -> end)
//   dims     lengths worth labelling once { p, q, side, value, key }; `side` is the
//            logical unit vector of the side the label goes on
//   angle    a central angle to mark { center, radius (of its sector), startDeg, endDeg, value } (cone)

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

/** Edges of the faces, each drawn once; an edge two faces share is a fold. */
function edgesOf(faces) {
  const key = ([x, y]) => `${x.toFixed(9)},${y.toFixed(9)}`;
  const byKey = new Map();
  for (const face of faces) {
    for (let i = 0; i < face.length; i++) {
      const p = face[i];
      const q = face[(i + 1) % face.length];
      const k = [key(p), key(q)].sort().join('|');
      const seen = byKey.get(k);
      if (seen) seen.fold = true;
      else byKey.set(k, { p, q, fold: false });
    }
  }
  return [...byKey.values()];
}

/**
 * Cuboid net in the common textbook layout: the four side faces in a row
 * (left, front, right, back) with the top and bottom attached to the front.
 */
export function boxNet({ width, height, depth }) {
  if (!(width > 0 && height > 0 && depth > 0)) {
    return { ok: false, reason: '寸法はすべて正の数で入力してください。' };
  }
  const [w, h, d] = [width, height, depth];
  // Bottom row is y = 0; the side strip sits on top of the bottom face.
  const faces = [
    rect(d, 0, d + w, d), // bottom
    rect(0, d, d, d + h), // left
    rect(d, d, d + w, d + h), // front
    rect(d + w, d, 2 * d + w, d + h), // right
    rect(2 * d + w, d, 2 * d + 2 * w, d + h), // back
    rect(d, d + h, d + w, 2 * d + h), // top
  ];
  const dims = [
    { key: 'width', value: w, p: [d, 2 * d + h], q: [d + w, 2 * d + h], side: [0, 1] },
    { key: 'depth', value: d, p: [d, d + h], q: [d, 2 * d + h], side: [-1, 0] },
    { key: 'height', value: h, p: [0, d], q: [0, d + h], side: [-1, 0] },
  ];
  return { ok: true, faces, lines: edgesOf(faces), circles: [], sectors: [], dims };
}

export function cubeNet({ size }) {
  if (!(size > 0)) return { ok: false, reason: '一辺の長さは正の数で入力してください。' };
  const net = boxNet({ width: size, height: size, depth: size });
  // One length says it all for a cube.
  return { ...net, dims: net.dims.filter((dim) => dim.key === 'width') };
}

/**
 * Cylinder net: the side as a rectangle (circumference x height) with the two
 * bases touching the middle of its top and bottom edges. `pi` is the value of
 * π used for the circumference (3.14 in Japanese elementary school).
 */
export function cylinderNet({ radius, height, pi = Math.PI }) {
  if (!(radius > 0 && height > 0)) {
    return { ok: false, reason: '半径と高さは正の数で入力してください。' };
  }
  const c = 2 * pi * radius;
  const faces = [rect(0, 0, c, height)];
  const circles = [
    { center: [c / 2, height + radius], radius },
    { center: [c / 2, -radius], radius },
  ];
  const top = circles[0].center;
  const dims = [
    // Inside the rectangle: above and below its edges' middles sit the bases.
    { key: 'circumference', value: c, p: [0, height], q: [c, height], side: [0, -1] },
    { key: 'height', value: height, p: [0, 0], q: [0, height], side: [-1, 0] },
    { key: 'radius', value: radius, p: top, q: [top[0] + radius, top[1]], side: [0, 1], radiusLine: true },
  ];
  return { ok: true, faces, lines: edgesOf(faces), circles, sectors: [], dims };
}

/**
 * Cone net: the lateral surface as a sector of radius `slant` (母線) and
 * central angle 360 * radius / slant, apex on top, with the base circle
 * touching the middle of its arc.
 */
export function coneNet({ radius, slant }) {
  if (!(radius > 0 && slant > 0)) {
    return { ok: false, reason: '半径と母線の長さは正の数で入力してください。' };
  }
  if (!(slant > radius)) {
    return { ok: false, reason: '母線の長さは底面の半径より長くしてください。' };
  }
  const angle = (360 * radius) / slant;
  const startDeg = -90 - angle / 2;
  const endDeg = -90 + angle / 2;
  const at = (deg) => [slant * Math.cos((deg * Math.PI) / 180), slant * Math.sin((deg * Math.PI) / 180)];
  const apex = [0, 0];
  const base = { center: [0, -slant - radius], radius };
  const a = at(startDeg);
  const dims = [
    // On the outer side of the left radius (the arc's middle is inside the sector).
    { key: 'slant', value: slant, p: a, q: apex, side: outwardOf(a, apex, [0, -slant]) },
    { key: 'radius', value: radius, p: base.center, q: [base.center[0] + radius, base.center[1]], side: [0, 1], radiusLine: true },
  ];
  return {
    ok: true,
    faces: [],
    lines: [],
    circles: [base],
    sectors: [{ center: apex, radius: slant, startDeg, endDeg }],
    dims,
    angle: { center: apex, radius: slant, startDeg, endDeg, value: angle },
  };
}

/** Unit normal of segment p-q (non-degenerate) pointing away from `inside`. */
function outwardOf(p, q, inside) {
  const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
  const len = Math.hypot(dx, dy);
  let n = [-dy / len, dx / len];
  const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  if (n[0] * (inside[0] - mid[0]) + n[1] * (inside[1] - mid[1]) > 0) n = [-n[0], -n[1]];
  return n;
}

export const NET_FACTORIES = { cube: cubeNet, box: boxNet, cylinder: cylinderNet, cone: coneNet };
