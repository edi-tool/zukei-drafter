// Pure 2D geometry calculations. No DOM / SVG dependencies.
// All angles in these public APIs are in degrees unless noted otherwise.

export const EPSILON = 1e-6;

function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Regular polygon with `sides` vertices, given edge length and rotation.
 * @returns {{points:[number,number][]}}
 */
export function regularPolygon({ sides, sideLength, rotationDeg = 0 }) {
  if (!Number.isInteger(sides) || sides < 3) {
    throw new RangeError('sides must be an integer >= 3');
  }
  if (!(sideLength > 0)) {
    throw new RangeError('sideLength must be > 0');
  }
  const circumradius = sideLength / (2 * Math.sin(Math.PI / sides));
  const points = [];
  for (let i = 0; i < sides; i++) {
    const angle = deg2rad(rotationDeg) + (2 * Math.PI * i) / sides;
    points.push([circumradius * Math.cos(angle), circumradius * Math.sin(angle)]);
  }
  return { points };
}

function isValidTriangleSides(a, b, c) {
  return a > 0 && b > 0 && c > 0 && a + b > c + EPSILON && b + c > a + EPSILON && a + c > b + EPSILON;
}

/**
 * Triangle from three side lengths (SSS).
 * Convention: a = |AB|, b = |AC|, c = |BC|.
 */
export function triangleFromSSS({ a, b, c }) {
  if (!isValidTriangleSides(a, b, c)) {
    return { ok: false, reason: '三角形の成立条件（三角不等式）を満たしていません。' };
  }
  // Place A at origin, B at (a, 0), solve for C using law of cosines.
  const A = [0, 0];
  const B = [a, 0];
  const cosA = (a * a + b * b - c * c) / (2 * a * b);
  const clamped = Math.min(1, Math.max(-1, cosA));
  const angleA = Math.acos(clamped);
  const C = [b * Math.cos(angleA), b * Math.sin(angleA)];
  return { ok: true, points: [A, B, C] };
}

/**
 * Triangle from two sides and the included angle (SAS).
 * sideA and sideB share the vertex at the origin; angleC is the angle between them.
 */
export function triangleFromSAS({ sideA, angleC, sideB }) {
  if (!(sideA > 0) || !(sideB > 0)) {
    return { ok: false, reason: '辺の長さは正の数である必要があります。' };
  }
  if (!(angleC > 0 && angleC < 180)) {
    return { ok: false, reason: '角度は 0°〜180° の範囲で指定してください。' };
  }
  const A = [0, 0];
  const B = [sideA, 0];
  const rad = deg2rad(angleC);
  const C = [sideB * Math.cos(rad), sideB * Math.sin(rad)];
  return { ok: true, points: [A, B, C] };
}

/**
 * Triangle from one side and the two angles adjacent to it (ASA).
 * `side` runs from vertex A to vertex B; angleA/angleB are the interior
 * angles at A and B respectively.
 */
export function triangleFromASA({ side, angleA, angleB }) {
  if (!(side > 0)) {
    return { ok: false, reason: '辺の長さは正の数である必要があります。' };
  }
  if (!(angleA > 0 && angleB > 0 && angleA + angleB < 180)) {
    return { ok: false, reason: '両端の角の和は180°未満である必要があります。' };
  }
  const A = [0, 0];
  const B = [side, 0];
  const ra = deg2rad(angleA);
  const rb = deg2rad(angleB);
  // Ray from A at angle angleA above the AB axis; ray from B at (180 - angleB).
  const d1 = [Math.cos(ra), Math.sin(ra)];
  const d2 = [-Math.cos(rb), Math.sin(rb)];
  // Solve A + t*d1 = B + s*d2 for t (Cramer's rule).
  const denom = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(denom) < EPSILON) {
    return { ok: false, reason: '三角形が成立しません（角度の組み合わせを確認してください）。' };
  }
  const bx = B[0] - A[0];
  const by = B[1] - A[1];
  const t = (bx * d2[1] - by * d2[0]) / denom;
  const C = [A[0] + t * d1[0], A[1] + t * d1[1]];
  return { ok: true, points: [A, B, C] };
}

/**
 * General polygon defined by a sequence of edge lengths and absolute heading
 * angles (degrees, measured counter-clockwise from the positive x-axis).
 * Does not auto-correct if the path fails to close.
 */
export function generalPolygon({ lengths, headingsDeg }) {
  if (lengths.length !== headingsDeg.length) {
    throw new RangeError('lengths and headingsDeg must have the same length');
  }
  if (lengths.length < 3) {
    throw new RangeError('a polygon needs at least 3 edges');
  }
  const points = [[0, 0]];
  let [x, y] = [0, 0];
  for (let i = 0; i < lengths.length; i++) {
    const rad = deg2rad(headingsDeg[i]);
    x += lengths[i] * Math.cos(rad);
    y += lengths[i] * Math.sin(rad);
    points.push([x, y]);
  }
  const start = points[0];
  const end = points[points.length - 1];
  const closureError = Math.hypot(end[0] - start[0], end[1] - start[1]);
  const closed = closureError <= EPSILON;
  // Drop the duplicated closing vertex from the returned point list.
  const outPoints = closed ? points.slice(0, -1) : points;
  return { points: outPoints, closed, closureError };
}

/**
 * Scale + translate a set of 2D points to fit within a target box, preserving
 * aspect ratio, leaving `margin` on every side.
 */
export function fitToViewBox(points, { width, height, margin = 20 }) {
  if (points.length === 0) {
    return { points: [], scale: 1 };
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const availW = width - margin * 2;
  const availH = height - margin * 2;
  const scale = Math.min(availW / spanX, availH / spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const targetCx = width / 2;
  const targetCy = height / 2;
  // Flip Y because SVG y grows downward while our logical coords use math convention.
  const fitted = points.map(([x, y]) => [
    targetCx + (x - cx) * scale,
    targetCy - (y - cy) * scale,
  ]);
  return { points: fitted, scale };
}
