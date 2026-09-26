// Circles projected through a linear 3D->2D map.
// The 3D circle  C + r*cos(t)*u + r*sin(t)*w  maps to the 2D curve
//   E(t) = L(C) + cos(t)*A + sin(t)*B,  A = L(r*u), B = L(r*w),
// which is always an ellipse. Working directly with this parametric form
// keeps the parameter t shared between 3D (visibility) and 2D (drawing).

import { applyMatrix } from './projections.js';

function normalize(p) {
  const l = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / l, y: p.y / l, z: p.z / l };
}

function cross(p, q) {
  return {
    x: p.y * q.z - p.z * q.y,
    y: p.z * q.x - p.x * q.z,
    z: p.x * q.y - p.y * q.x,
  };
}

function scale3(p, k) {
  return { x: p.x * k, y: p.y * k, z: p.z * k };
}

/** Orthonormal basis (u, w) of the plane perpendicular to `axis`. */
export function circleBasis(axis) {
  const a = normalize(axis);
  const helper = Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = normalize(cross(helper, a));
  const w = normalize(cross(a, u));
  return { u, w };
}

/** @returns {{center:number[], A:number[], B:number[], u:object, w:object}} */
export function projectCircle(matrix, center, radius, axis) {
  const { u, w } = circleBasis(axis);
  return {
    center: applyMatrix(matrix, center),
    A: applyMatrix(matrix, scale3(u, radius)),
    B: applyMatrix(matrix, scale3(w, radius)),
    u,
    w,
  };
}

export function ellipsePoint(e, t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [e.center[0] + e.A[0] * c + e.B[0] * s, e.center[1] + e.A[1] * c + e.B[1] * s];
}

function ellipseDerivative(e, t) {
  const c = Math.cos(t);
  const s = Math.sin(t);
  return [-e.A[0] * s + e.B[0] * c, -e.A[1] * s + e.B[1] * c];
}

/** Exact axis-aligned bounding box: x(t) = cx + Ax cos t + Bx sin t has amplitude hypot(Ax, Bx). */
export function ellipseBBox(e) {
  const hx = Math.hypot(e.A[0], e.B[0]);
  const hy = Math.hypot(e.A[1], e.B[1]);
  return { minX: e.center[0] - hx, maxX: e.center[0] + hx, minY: e.center[1] - hy, maxY: e.center[1] + hy };
}

/**
 * Cubic Bezier segments approximating the arc from t0 to t1 (t1 > t0).
 * The standard circle-arc construction is affine-invariant, so applying it
 * to the parametric ellipse is exactly as accurate as for a circle
 * (relative error < 3e-4 per quarter turn), and any later affine mapping
 * (e.g. fitting to the viewport) can be applied to the control points.
 * @returns {Array<[number[], number[], number[], number[]]>}
 */
export function ellipseArcBeziers(e, t0, t1) {
  const count = Math.max(1, Math.ceil((t1 - t0) / (Math.PI / 2) - 1e-9));
  const step = (t1 - t0) / count;
  const k = (4 / 3) * Math.tan(step / 4);
  const segments = [];
  for (let i = 0; i < count; i++) {
    const a = t0 + i * step;
    const b = a + step;
    const p0 = ellipsePoint(e, a);
    const p3 = ellipsePoint(e, b);
    const d0 = ellipseDerivative(e, a);
    const d3 = ellipseDerivative(e, b);
    segments.push([p0, [p0[0] + k * d0[0], p0[1] + k * d0[1]], [p3[0] - k * d3[0], p3[1] - k * d3[1]], p3]);
  }
  return segments;
}
