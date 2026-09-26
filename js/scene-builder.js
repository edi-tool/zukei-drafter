// Bridges geometry2d / geometry3d / projections / hidden-line / curved-solids
// into the plain-data "scene" consumed by render-svg.js. Pure functions: no
// DOM access, so this module is unit-testable under Node.
//
// Layout: the scene size follows the figure's aspect ratio. The longer side
// of the figure is scaled to `size - 2 * margin`, so the exported image is
// tight around the drawing with a uniform margin instead of a fixed square.

import * as geometry3d from './geometry3d.js';
import { matrixOf, applyMatrix, viewDirectionOf } from './projections.js';
import { classifyEdges } from './hidden-line.js';
import { ellipseBBox, ellipseArcBeziers, ellipsePoint } from './ellipse.js';
import { cylinderOutline, coneOutline } from './curved-solids.js';
import { buildAnnotationItems, annotationsActive } from './annotation-layout.js';

const DEFAULT_SIZE = 800;

const DEFAULT_STYLE = {
  stroke: '#111111',
  strokeWidth: 2,
  fill: 'none',
  size: DEFAULT_SIZE,
  margin: 32,
  hiddenLineMode: 'dashed',
};

/**
 * Affine map from logical coordinates (y up) to SVG coordinates (y down).
 * Because it is affine, Bezier control points can be mapped through it too.
 */
export function computeFit(bbox, size, margin) {
  const spanX = bbox.maxX - bbox.minX;
  const spanY = bbox.maxY - bbox.minY;
  const longest = Math.max(spanX, spanY) || 1;
  const scale = (size - 2 * margin) / longest;
  const width = Math.round(spanX * scale + 2 * margin);
  const height = Math.round(spanY * scale + 2 * margin);
  // Center inside the rounded canvas so rounding never clips the margin.
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const map = ([x, y]) => [offsetX + (x - bbox.minX) * scale, offsetY + (bbox.maxY - y) * scale];
  return { width, height, scale, map };
}

function bboxOfPoints(points) {
  const bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    bbox.minX = Math.min(bbox.minX, x);
    bbox.maxX = Math.max(bbox.maxX, x);
    bbox.minY = Math.min(bbox.minY, y);
    bbox.maxY = Math.max(bbox.maxY, y);
  }
  return bbox;
}

function unionBBox(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    maxX: Math.max(a.maxX, b.maxX),
    minY: Math.min(a.minY, b.minY),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** Andrew's monotone chain convex hull; used as the fill region of a convex solid. */
export function convexHull(points) {
  const pts = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (pts.length < 3) return pts;
  const crossZ = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function strokeStyle(s, hidden) {
  return {
    stroke: s.stroke,
    strokeWidth: hidden ? Math.max(0.5, s.strokeWidth * 0.75) : s.strokeWidth,
    dash: hidden,
  };
}

function fillItem(s, hullPoints) {
  if (s.fill === 'none') return [];
  return [{ type: 'polygon', points: hullPoints, stroke: 'none', strokeWidth: 0, fill: s.fill }];
}

function scene(fit, s, items) {
  return { width: fit.width, height: fit.height, background: s.background ?? 'none', items, meta: { scale: fit.scale } };
}

function translatePoint([x, y], dx, dy) {
  return [x + dx, y + dy];
}

function translateItem(item, dx, dy) {
  if (item.type === 'text') return { ...item, point: translatePoint(item.point, dx, dy) };
  if (item.points) return { ...item, points: item.points.map((p) => translatePoint(p, dx, dy)) };
  return item;
}

/**
 * Scene for a flat 2D shape; an open (non-closing) path is drawn as a
 * polyline. `annotations` (see js/annotation-layout.js for the shape) adds
 * vertex labels / edge lengths / dimension lines / angle arcs / right-angle
 * marks. Annotations can draw outside the shape's own bounding box, so when
 * any are enabled the canvas is grown (and everything re-centered) in a
 * second pass so nothing gets clipped at the edge of the image; with no
 * annotations this reduces to the original single-pass fit.
 */
export function buildScene2D(points, closed, style = {}, annotations = {}) {
  const s = { ...DEFAULT_STYLE, ...style };
  const fit = computeFit(bboxOfPoints(points), s.size, s.margin);
  const mapped = points.map(fit.map);
  const shapeItem = closed
    ? { type: 'polygon', points: mapped, stroke: s.stroke, strokeWidth: s.strokeWidth, fill: s.fill }
    : { type: 'polyline', points: mapped, stroke: s.stroke, strokeWidth: s.strokeWidth };

  if (!annotationsActive(annotations)) {
    return scene(fit, s, [shapeItem]);
  }

  const { items: annotationItems, bbox: annotationBBox } = buildAnnotationItems(points, closed, fit, annotations, s.stroke);
  if (!annotationBBox) return scene(fit, s, [shapeItem]);

  const overflowLeft = Math.max(0, s.margin - annotationBBox.minX);
  const overflowTop = Math.max(0, s.margin - annotationBBox.minY);
  const overflowRight = Math.max(0, annotationBBox.maxX - (fit.width - s.margin));
  const overflowBottom = Math.max(0, annotationBBox.maxY - (fit.height - s.margin));

  if (overflowLeft === 0 && overflowTop === 0 && overflowRight === 0 && overflowBottom === 0) {
    return scene(fit, s, [shapeItem, ...annotationItems]);
  }

  const width = Math.round(fit.width + overflowLeft + overflowRight);
  const height = Math.round(fit.height + overflowTop + overflowBottom);
  const dx = overflowLeft;
  const dy = overflowTop;
  const shifted = [shapeItem, ...annotationItems].map((it) => translateItem(it, dx, dy));
  return { width, height, background: s.background ?? 'none', items: shifted, meta: { scale: fit.scale } };
}

const SHAPE_FACTORIES = {
  cube: geometry3d.cube,
  box: geometry3d.box,
  triangularPrism: geometry3d.triangularPrism,
  quadrangularPrism: geometry3d.quadrangularPrism,
  triangularPyramid: geometry3d.triangularPyramid,
  quadrangularPyramid: geometry3d.quadrangularPyramid,
  cylinder: geometry3d.cylinder,
  cone: geometry3d.cone,
};

/**
 * @param {string} shapeName one of the keys of SHAPE_FACTORIES
 * @param {object} shapeParams passed straight to the shape factory
 * @param {string} projectionName 'isometric' | 'cavalier' | 'cabinet' | 'oblique'
 * @param {object} projectionOptions e.g. { angleDeg, scale }
 * @param {{hiddenLineMode?: 'dashed'|'hidden'}} style plus stroke/fill/size options
 */
export function buildScene3D(shapeName, shapeParams, projectionName, projectionOptions = {}, style = {}) {
  const factory = SHAPE_FACTORIES[shapeName];
  if (!factory) throw new RangeError(`unknown 3D shape: ${shapeName}`);
  const shape = factory(shapeParams);
  const matrix = matrixOf(projectionName, projectionOptions);
  const viewDir = viewDirectionOf(projectionName, projectionOptions);
  const s = { ...DEFAULT_STYLE, ...style };

  if (shape.kind === 'cylinder' || shape.kind === 'cone') {
    const outline = shape.kind === 'cylinder' ? cylinderOutline(shape, matrix, viewDir) : coneOutline(shape, matrix, viewDir);
    return buildCurvedScene(outline, s);
  }
  return buildPolyhedronScene(shape, matrix, viewDir, s);
}

function buildPolyhedronScene(shape, matrix, viewDir, s) {
  const projected = shape.vertices.map((p) => applyMatrix(matrix, p));
  const { hidden } = classifyEdges(shape.vertices, shape.faces, shape.edges, viewDir);
  const fit = computeFit(bboxOfPoints(projected), s.size, s.margin);
  const mapped = projected.map(fit.map);

  const hiddenItems = [];
  const visibleItems = [];
  for (const edge of shape.edges) {
    const isHidden = hidden.has(`${edge.a}_${edge.b}`);
    if (isHidden && s.hiddenLineMode === 'hidden') continue;
    const line = { type: 'line', points: [mapped[edge.a], mapped[edge.b]], ...strokeStyle(s, isHidden) };
    (isHidden ? hiddenItems : visibleItems).push(line);
  }
  return scene(fit, s, [...fillItem(s, convexHull(mapped)), ...hiddenItems, ...visibleItems]);
}

function arcPath(ellipse, arc, map) {
  const segments = ellipseArcBeziers(ellipse, arc.t0, arc.t1);
  const fmt = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
  let d = `M${fmt(map(segments[0][0]))}`;
  for (const [, c1, c2, p3] of segments) {
    d += ` C${fmt(map(c1))} ${fmt(map(c2))} ${fmt(map(p3))}`;
  }
  return d;
}

function buildCurvedScene(outline, s) {
  let bbox = bboxOfPoints(outline.extraPoints.length ? outline.extraPoints : [outline.rims[0].ellipse.center]);
  for (const rim of outline.rims) bbox = unionBBox(bbox, ellipseBBox(rim.ellipse));
  const fit = computeFit(bbox, s.size, s.margin);

  const samples = [...outline.extraPoints];
  for (const rim of outline.rims) {
    for (let i = 0; i < 96; i++) samples.push(ellipsePoint(rim.ellipse, (2 * Math.PI * i) / 96));
  }

  const hiddenItems = [];
  const visibleItems = [];
  for (const rim of outline.rims) {
    for (const arc of rim.arcs) {
      const isHidden = !arc.visible;
      if (isHidden && s.hiddenLineMode === 'hidden') continue;
      const item = { type: 'path', d: arcPath(rim.ellipse, arc, fit.map), fill: 'none', ...strokeStyle(s, isHidden) };
      (isHidden ? hiddenItems : visibleItems).push(item);
    }
  }
  for (const [p, q] of outline.silhouettes) {
    visibleItems.push({ type: 'line', points: [fit.map(p), fit.map(q)], ...strokeStyle(s, false) });
  }
  return scene(fit, s, [...fillItem(s, convexHull(samples.map(fit.map))), ...hiddenItems, ...visibleItems]);
}
