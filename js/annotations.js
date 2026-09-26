// Pure geometry helpers for 2D annotations (vertex labels, edge lengths,
// dimension lines, interior angles, right-angle marks). No DOM/SVG, no
// knowledge of the SVG coordinate frame — everything here works in the same
// logical coordinate space as js/geometry2d.js. Distances passed in (e.g.
// `distance`, `offset`, `radius`) are expected in *logical* units; callers
// that receive pixel-space UI settings convert with `pixelsToLogical`
// before calling into this module (see js/annotation-layout.js).
//
// Angles are computed directly from vertex coordinates via atan2/dot/cross,
// never by measuring the rendered SVG, so they stay correct regardless of
// how the shape is scaled or mirrored for display.

export const RIGHT_ANGLE_EPSILON_DEG = 0.5;

function sub(a, b) {
  return [a[0] - b[0], a[1] - b[1]];
}

function norm(v) {
  const len = Math.hypot(v[0], v[1]);
  return len > 1e-12 ? [v[0] / len, v[1] / len] : [0, 0];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1];
}

function cross(a, b) {
  return a[0] * b[1] - a[1] * b[0];
}

/** Convert a UI pixel-space length into the logical-unit length that maps to it. */
export function pixelsToLogical(px, scale) {
  return scale > 0 ? px / scale : px;
}

export function centroid(points) {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}

/**
 * Signed polygon area (shoelace / 2). Positive = counter-clockwise in a
 * standard y-up coordinate system. Only meaningful for closed polygons.
 */
export function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

/**
 * Outward-facing unit direction for each vertex of a closed polygon, used to
 * place vertex-name labels. Uses the external angle bisector of the two
 * incident edges (so labels hug corners naturally instead of being pushed
 * off in one fixed direction); falls back to the centroid->vertex direction
 * for degenerate (near-straight or coincident) vertices, and is always used
 * for open paths since there is no well-defined "outward" bisector there.
 */
export function vertexOutwardDirections(points, closed) {
  const c = centroid(points);
  const n = points.length;
  return points.map((p, i) => {
    const fallback = norm(sub(p, c));
    if (!closed || n < 3) return fallback;
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const toPrev = norm(sub(prev, p));
    const toNext = norm(sub(next, p));
    const inward = norm([toPrev[0] + toNext[0], toPrev[1] + toNext[1]]);
    if (inward[0] === 0 && inward[1] === 0) return fallback;
    // The interior bisector points inward; outward is its negation. Pick the
    // sign that actually points away from the centroid, so it is correct for
    // both convex and reflex (concave) vertices.
    const outward = [-inward[0], -inward[1]];
    return dot(outward, fallback) >= 0 ? outward : [-outward[0], -outward[1]];
  });
}

/** Per-edge geometry: endpoints, length, midpoint, unit direction, outward normal. */
export function edgeGeometry(points, closed) {
  const n = points.length;
  const edgeCount = closed ? n : n - 1;
  const c = centroid(points);
  const edges = [];
  for (let i = 0; i < edgeCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const dir = norm(sub(b, a));
    // Two candidate normals; pick the one pointing away from the centroid.
    const candidate = [-dir[1], dir[0]];
    const normal = dot(candidate, sub(midpoint, c)) >= 0 ? candidate : [-candidate[0], -candidate[1]];
    edges.push({ a: i, b: (i + 1) % n, from: a, to: b, length, midpoint, dir, normal });
  }
  return edges;
}

/**
 * Interior angle (degrees) at each vertex of a closed polygon, computed from
 * the turning angle so it stays correct for both convex and reflex
 * (concave) vertices and for either winding direction.
 */
export function interiorAngles(points) {
  const n = points.length;
  if (n < 3) return [];
  const orientation = Math.sign(signedArea(points)) || 1;
  const result = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const vertex = points[i];
    const next = points[(i + 1) % n];
    const edgeIn = sub(vertex, prev);
    const edgeOut = sub(next, vertex);
    const turn = Math.atan2(cross(edgeIn, edgeOut), dot(edgeIn, edgeOut));
    const orientedTurn = orientation < 0 ? -turn : turn;
    const interiorRad = Math.PI - orientedTurn;
    const angleDeg = (interiorRad * 180) / Math.PI;
    result.push({
      index: i,
      vertex,
      angleDeg,
      dirToPrev: norm(sub(prev, vertex)),
      dirToNext: norm(sub(next, vertex)),
    });
  }
  return result;
}

export function isRightAngle(angleDeg, epsilonDeg = RIGHT_ANGLE_EPSILON_DEG) {
  return Math.abs(angleDeg - 90) <= epsilonDeg;
}

/** Sequence of vertex label letters: A, B, ..., Z, AA, AB, ... */
export function vertexLabelLetters(count) {
  const letters = [];
  for (let i = 0; i < count; i++) {
    let n = i;
    let label = '';
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    letters.push(label);
  }
  return letters;
}

const UNIT_LABEL = { none: '', mm: ' mm', cm: ' cm' };
const UNIT_FACTOR = { none: 1, mm: 1, cm: 0.1 };

/** Format a logical-unit length for display, applying unit conversion + decimals. */
export function formatLength(value, unit = 'none', decimals = 0) {
  const factor = UNIT_FACTOR[unit] ?? 1;
  const suffix = UNIT_LABEL[unit] ?? '';
  return `${(value * factor).toFixed(Math.max(0, decimals))}${suffix}`;
}

/** Format an angle in degrees for display. */
export function formatAngle(value, decimals = 0) {
  return `${value.toFixed(Math.max(0, decimals))}°`;
}
