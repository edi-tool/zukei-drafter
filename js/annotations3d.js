// 3D dimension annotations: labels one representative edge per axis for a
// polyhedron (see geometry3d.js `dimensions`: width/height/depth or a single
// base edge + height, chosen because a solid has many edges of the same
// length and labelling all of them would be unreadable), plus radius and
// height for the curved solids (cylinder, cone).
//
// Reuses the 2D dimension-line drawing (annotations.js `buildDimensionLine`)
// so the visual language matches the 2D "寸法線" annotation. A "synthetic"
// dimension - one with no matching edge on the solid itself (a pyramid's
// height, from the apex straight down to the base; a cylinder/cone's radius
// or height) - is drawn directly along its own line, dashed like a
// construction line, since nothing else marks it as not a real edge.
//
// Pure functions: no DOM access, so this module is unit-testable under Node.
// Coordinates are already projected to SVG px (see the `project`/`mapped`
// parameters below); this module only lays labels out in that 2D space.

import { estimateTextBox, formatNumber, buildDimensionLine, support, textItem } from './annotations.js';
import { circleBasis } from './ellipse.js';

const DEFAULTS = {
  show: false,
  unit: '',
  decimals: 1,
  fontSize: 18,
  color: '#111111',
  strokeWidth: 2,
};

export function hasDimensions3D(options) {
  return Boolean(options && options.show);
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const norm = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n] : [0, 0];
};

/** Perpendicular to p-q, on the side away from `centroid` (px space). */
function outwardDir(p, q, centroid) {
  const u = unit(sub(q, p));
  let n = [-u[1], u[0]];
  const mid = mul(add(p, q), 0.5);
  if (dot(n, sub(mid, centroid)) < 0) n = mul(n, -1);
  return n;
}

/**
 * The first of `edges` (each `[a,b]` a vertex-index pair) that the current
 * viewing angle does not hide, or the first one if all are hidden (a rare,
 * near edge-on view). A hidden (back) edge's 2D-perpendicular can point
 * toward the viewer but still land inside the solid's own silhouette, so
 * picking a visible edge is what keeps `outwardDir` below correct.
 */
function visibleEdge(edges, hidden) {
  return edges.find(([a, b]) => !hidden.has(`${Math.min(a, b)}_${Math.max(a, b)}`)) ?? edges[0];
}

function rectCorners(center, box) {
  return [
    [center[0] - box.width / 2, center[1] - box.height / 2],
    [center[0] + box.width / 2, center[1] + box.height / 2],
  ];
}

/**
 * One dimension line for the segment p-q, plus its label.
 * `synthetic` (no matching edge on the solid) draws directly on p-q, dashed;
 * otherwise the line stands off from p-q, in direction `outward`, like the
 * 2D "寸法線" style.
 */
function dimensionItem(p, q, outward, text, o, synthetic) {
  const offset = synthetic ? 0 : o.fontSize * 0.9;
  const lineWidth = Math.max(0.75, o.strokeWidth * 0.6);
  const { lines, arrows, p2, q2 } = buildDimensionLine(p, q, outward, offset, o.color, o.fontSize);
  const items = lines.map(([a, b], i) => ({
    type: 'line',
    points: [a, b],
    stroke: o.color,
    strokeWidth: lineWidth,
    dash: synthetic && i === lines.length - 1,
  }));
  items.push(...arrows);

  const box = estimateTextBox(text, o.fontSize);
  const gap = o.fontSize * 0.3;
  const mid = mul(add(p2, q2), 0.5);
  const labelCenter = add(mid, mul(outward, gap + support(box.width / 2, box.height / 2, outward)));
  items.push(textItem(labelCenter, text, o));

  const covered = [...lines.flat(), ...arrows.flatMap((a) => a.points), ...rectCorners(labelCenter, box)];
  return { items, covered };
}

function boundsOf(points) {
  let bounds = null;
  for (const [x, y] of points) {
    bounds ??= { minX: x, maxX: x, minY: y, maxY: y };
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  return bounds;
}

function labelText(dim, o) {
  return `${dim.label} ${formatNumber(dim.value, o.decimals)}${o.unit}`;
}

/**
 * @param {object} shape a geometry3d.js polyhedron (has .vertices, .dimensions)
 * @param {number[][]} mapped shape.vertices already projected to px (fit.map(applyMatrix(matrix, v)))
 * @param {(v3d:{x,y,z}) => number[]} project projects an arbitrary 3D point to the same px space,
 *   for a synthetic dimension's endpoints (e.g. a pyramid's apex-to-base-center height line)
 * @param {Set<string>} hidden edge keys ("min_max") the current viewing angle hides, from
 *   hidden-line.js `classifyEdges`, so a dimension with several candidate edges (`dim.edges`,
 *   every edge of that length) can pick one that is actually visible
 * @param {object} options see DEFAULTS
 * @returns {{items: object[], bounds: {minX,maxX,minY,maxY}|null}}
 */
export function polyhedronDimensionItems(shape, mapped, project, hidden, options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (!hasDimensions3D(o) || !shape.dimensions?.length) return { items: [], bounds: null };
  const centroid = mapped.reduce((c, p) => add(c, p), [0, 0]).map((v) => v / mapped.length);
  const items = [];
  const covered = [];
  for (const dim of shape.dimensions) {
    const [a, b] = dim.edges ? visibleEdge(dim.edges, hidden) : [];
    const p = dim.edges ? mapped[a] : project(dim.from);
    const q = dim.edges ? mapped[b] : project(dim.to);
    const r = dimensionItem(p, q, outwardDir(p, q, centroid), labelText(dim, o), o, Boolean(dim.synthetic));
    items.push(...r.items);
    covered.push(...r.covered);
  }
  return { items, bounds: boundsOf(covered) };
}

/**
 * @param {'cylinder'|'cone'} kind
 * @param {object} shape a geometry3d.js cylinder()/cone() (radius, height, axis, and either
 *   bottomCenter/topCenter or baseCenter/apex)
 * @param {(v3d:{x,y,z}) => number[]} project projects a 3D point to px (fit.map(applyMatrix(matrix, v)))
 * @param {object} options see DEFAULTS
 * @returns {{items: object[], bounds: {minX,maxX,minY,maxY}|null}}
 */
export function curvedDimensionItems(kind, shape, project, options = {}) {
  const o = { ...DEFAULTS, ...options };
  if (!hasDimensions3D(o)) return { items: [], bounds: null };
  const base = kind === 'cylinder' ? shape.bottomCenter : shape.baseCenter;
  const top = kind === 'cylinder' ? shape.topCenter : shape.apex;
  const { u } = circleBasis(shape.axis);
  const rimPoint = { x: base.x + u.x * shape.radius, y: base.y + u.y * shape.radius, z: base.z + u.z * shape.radius };

  const pBase = project(base);
  const pTop = project(top);
  const pRim = project(rimPoint);
  const centroid = mul(add(pBase, pTop), 0.5);

  const radiusLabel = labelText({ label: kind === 'cylinder' ? '半径' : '底面の半径', value: shape.radius }, o);
  const heightLabel = labelText({ label: '高さ', value: shape.height }, o);

  const items = [];
  const covered = [];
  for (const [p, q, text] of [[pBase, pRim, radiusLabel], [pBase, pTop, heightLabel]]) {
    const r = dimensionItem(p, q, outwardDir(p, q, centroid), text, o, true);
    items.push(...r.items);
    covered.push(...r.covered);
  }
  return { items, bounds: boundsOf(covered) };
}
