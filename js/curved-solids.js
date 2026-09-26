// Line-art outlines of cylinders and cones under a parallel projection.
// Visibility is decided in 3D: with `viewDir` pointing along the projectors
// toward the viewer, a surface point is visible when its outward normal has a
// positive component along viewDir. For a rim point at parameter t the
// lateral normal involves n(t) = cos(t)*u + sin(t)*w, and
//   n(t) . v = R * cos(t - phi),  R = hypot(u.v, w.v),  phi = atan2(w.v, u.v)
// so the silhouette generators (where the lateral surface turns edge-on)
// have closed-form parameters. Because viewDir is the exact projection
// direction, these generators are exactly tangent to the projected ellipses.

import { applyMatrix } from './projections.js';
import { projectCircle, ellipsePoint } from './ellipse.js';

const TWO_PI = 2 * Math.PI;
const EPS = 1e-9;

function dot(p, q) {
  return p.x * q.x + p.y * q.y + p.z * q.z;
}

function unit(p) {
  const l = Math.hypot(p.x, p.y, p.z);
  return { x: p.x / l, y: p.y / l, z: p.z / l };
}

function wrap(t) {
  const m = t % TWO_PI;
  return m < 0 ? m + TWO_PI : m;
}

/** Parameters t where R*cos(t - phi) == c (none if the lateral surface never turns edge-on). */
function solveCos(R, phi, c) {
  if (R < EPS || Math.abs(c) >= R - EPS) return [];
  const delta = Math.acos(c / R);
  return [wrap(phi - delta), wrap(phi + delta)].sort((a, b) => a - b);
}

/** Split the full turn at the given (sorted) parameters into arcs tagged visible/hidden. */
function splitArcs(transitions, isVisible) {
  if (transitions.length === 0) {
    return [{ t0: 0, t1: TWO_PI, visible: isVisible(0) }];
  }
  const [a, b] = transitions;
  return [
    { t0: a, t1: b, visible: isVisible((a + b) / 2) },
    { t0: b, t1: a + TWO_PI, visible: isVisible((a + b) / 2 + Math.PI) },
  ];
}

function lateralFrame(ellipse, viewDir) {
  const uv = dot(ellipse.u, viewDir);
  const wv = dot(ellipse.w, viewDir);
  const R = Math.hypot(uv, wv);
  const phi = Math.atan2(wv, uv);
  const nDotV = (t) => R * Math.cos(t - phi);
  return { R, phi, nDotV };
}

/**
 * @returns {{rims: {ellipse: object, arcs: {t0:number, t1:number, visible:boolean}[]}[],
 *            silhouettes: number[][][], extraPoints: number[][]}}
 */
export function cylinderOutline(shape, matrix, viewDir) {
  const axis = unit(shape.axis);
  const av = dot(axis, viewDir);
  const bottom = projectCircle(matrix, shape.bottomCenter, shape.radius, axis);
  const top = projectCircle(matrix, shape.topCenter, shape.radius, axis);
  const { R, phi, nDotV } = lateralFrame(bottom, viewDir);
  const ts = solveCos(R, phi, 0);
  const lateralVisible = (t) => nDotV(t) > 0;

  function rim(ellipse, capFacesViewer) {
    const arcs = capFacesViewer ? splitArcs([], () => true) : splitArcs(ts, lateralVisible);
    return { ellipse, arcs };
  }

  return {
    rims: [rim(bottom, -av > EPS), rim(top, av > EPS)],
    silhouettes: ts.map((t) => [ellipsePoint(bottom, t), ellipsePoint(top, t)]),
    extraPoints: [],
  };
}

export function coneOutline(shape, matrix, viewDir) {
  const axis = unit(shape.axis);
  const av = dot(axis, viewDir);
  const base = projectCircle(matrix, shape.baseCenter, shape.radius, axis);
  const apex = applyMatrix(matrix, shape.apex);
  const { R, phi, nDotV } = lateralFrame(base, viewDir);
  // Outward lateral normal at t is proportional to height*n(t) + radius*axis.
  const lateralVisible = (t) => shape.height * nDotV(t) + shape.radius * av > 0;
  const ts = solveCos(R, phi, (-shape.radius * av) / shape.height);
  const baseFacesViewer = -av > EPS;
  const arcs = baseFacesViewer ? splitArcs([], () => true) : splitArcs(ts, lateralVisible);

  return {
    rims: [{ ellipse: base, arcs }],
    silhouettes: ts.map((t) => [ellipsePoint(base, t), apex]),
    extraPoints: [apex],
  };
}
