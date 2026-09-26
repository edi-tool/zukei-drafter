// Analytic handling of circles projected through a linear 3D->2D map.
// A circle C + r*cos(t)*u + r*sin(t)*v, transformed by a linear map L, becomes
// the 2D parametric curve L(C) + cos(t)*L(r*u) + sin(t)*L(r*v) = center + cos(t)*A + sin(t)*B.
// This is always an ellipse (possibly degenerate); this module extracts its
// standard parameters (cx, cy, rx, ry, rotation) and answers tangent-line
// queries needed to draw cylinders and cones as teaching-quality line art.

import { applyMatrix } from './projections.js';

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot2(p, q) {
  return p[0] * q[0] + p[1] * q[1];
}

function len2(p) {
  return Math.hypot(p[0], p[1]);
}

/**
 * Project a 3D circle (center, radius, axis) through matrix `matrix` and
 * return its exact 2D ellipse parameters, plus the raw A/B basis vectors
 * (useful for sampling/tangent computations).
 */
export function projectCircleToEllipse(matrix, center, radius, axis) {
  // Build an orthonormal basis (u, v) spanning the plane perpendicular to axis.
  const a = normalize(axis);
  const arbitrary = Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  const u = normalize(cross(arbitrary, a));
  const w = normalize(cross(a, u));

  const centerXY = applyMatrix(matrix, center);
  const A = applyMatrix(matrix, { x: radius * u.x, y: radius * u.y, z: radius * u.z });
  const B = applyMatrix(matrix, { x: radius * w.x, y: radius * w.y, z: radius * w.z });

  const ellipse = ellipseFromParametric(centerXY, A, B);
  return { ...ellipse, u, v: w, A, B, centerXY };
}

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

/**
 * Given P(t) = center + cos(t)*A + sin(t)*B, find the ellipse's standard
 * parameters: center, semi-major/minor axis lengths, and rotation (degrees).
 */
export function ellipseFromParametric(center, A, B) {
  const AA = dot2(A, A);
  const BB = dot2(B, B);
  const AB = dot2(A, B);
  // Angle (in parameter space) of the axis extremes.
  let t0 = 0.5 * Math.atan2(2 * AB, AA - BB);
  const axis1 = pointAt(t0);
  const axis2 = pointAt(t0 + Math.PI / 2);
  function pointAt(t) {
    return [A[0] * Math.cos(t) + B[0] * Math.sin(t), A[1] * Math.cos(t) + B[1] * Math.sin(t)];
  }
  let r1 = len2(axis1);
  let r2 = len2(axis2);
  let major = axis1;
  let rx = r1;
  let ry = r2;
  if (r2 > r1) {
    major = axis2;
    rx = r2;
    ry = r1;
  }
  const rotationDeg = (Math.atan2(major[1], major[0]) * 180) / Math.PI;
  return { cx: center[0], cy: center[1], rx, ry, rotationDeg };
}

/**
 * Silhouette tangent points for a cylinder: the parameter values t where the
 * projected circle reaches a horizontal extreme relative to A/B (an
 * approximation of the true silhouette generators, exact when the cylinder
 * axis projects vertically, which holds for the supported projections here).
 */
export function silhouetteParams(A, B) {
  const t = Math.atan2(B[0], A[0]);
  return [t, t + Math.PI];
}

export function pointOnEllipseParam(center, A, B, t) {
  return [center[0] + A[0] * Math.cos(t) + B[0] * Math.sin(t), center[1] + A[1] * Math.cos(t) + B[1] * Math.sin(t)];
}

/**
 * Tangent points on an ellipse as seen from an external 2D point, computed by
 * mapping to a unit-circle space where the classic tangent-line construction
 * applies, then mapping back.
 * Returns null if the point is inside the ellipse (no real tangents).
 */
export function tangentPointsFromExternalPoint(ellipse, point) {
  const rad = (ellipse.rotationDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  // World -> ellipse-local (unrotated, unit-circle) space.
  function toLocal([x, y]) {
    const dx = x - ellipse.cx;
    const dy = y - ellipse.cy;
    const lx = dx * cos + dy * sin;
    const ly = -dx * sin + dy * cos;
    return [lx / ellipse.rx, ly / ellipse.ry];
  }
  function toWorld([lx, ly]) {
    const dx = lx * ellipse.rx;
    const dy = ly * ellipse.ry;
    const x = dx * cos - dy * sin + ellipse.cx;
    const y = dx * sin + dy * cos + ellipse.cy;
    return [x, y];
  }
  const [px, py] = toLocal(point);
  const d2 = px * px + py * py;
  if (d2 <= 1 + 1e-9) return null; // inside or on the unit circle: no external tangents
  const d = Math.sqrt(d2);
  const theta = Math.acos(1 / d);
  const alpha = Math.atan2(py, px);
  const t1 = alpha + theta;
  const t2 = alpha - theta;
  return [toWorld([Math.cos(t1), Math.sin(t1)]), toWorld([Math.cos(t2), Math.sin(t2)])];
}
