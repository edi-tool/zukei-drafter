// Bridges geometry2d / geometry3d / projections / hidden-line / ellipse into
// the plain-data "scene" format consumed by render-svg.js. Pure functions:
// no DOM access, so this module is unit-testable under Node.

import { fitToViewBox } from './geometry2d.js';
import * as geometry3d from './geometry3d.js';
import { matrixOf, applyMatrix, viewDirectionOf } from './projections.js';
import { classifyEdges } from './hidden-line.js';
import { projectCircleToEllipse, silhouetteParams, pointOnEllipseParam, tangentPointsFromExternalPoint } from './ellipse.js';

const DEFAULT_STYLE = {
  stroke: '#111111',
  strokeWidth: 2,
  fill: 'none',
  margin: 24,
};

/** Build a render-svg scene from an already-computed flat 2D point list. */
export function buildScene2D(points, closed, style = {}) {
  const s = { ...DEFAULT_STYLE, ...style };
  const { width = 600, height = 600 } = s;
  const { points: fitted } = fitToViewBox(points, { width, height, margin: s.margin });
  const items = [
    closed
      ? { type: 'polygon', points: fitted, stroke: s.stroke, strokeWidth: s.strokeWidth, fill: s.fill }
      : { type: 'polyline', points: fitted, stroke: s.stroke, strokeWidth: s.strokeWidth },
  ];
  return { width, height, background: s.background ?? 'none', items };
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
 * @param {{hiddenLineMode: 'dashed'|'hidden', ...style}} style
 */
export function buildScene3D(shapeName, shapeParams, projectionName, projectionOptions, style = {}) {
  const factory = SHAPE_FACTORIES[shapeName];
  if (!factory) throw new RangeError(`unknown 3D shape: ${shapeName}`);
  const shape = factory(shapeParams);
  const matrix = matrixOf(projectionName, projectionOptions);
  const s = { ...DEFAULT_STYLE, ...style };
  const { width = 600, height = 600, hiddenLineMode = 'dashed' } = s;

  if (shape.kind === 'cylinder') return buildCylinderScene(shape, matrix, s, width, height);
  if (shape.kind === 'cone') return buildConeScene(shape, matrix, s, width, height);

  const projected = shape.vertices.map((p) => applyMatrix(matrix, p));
  const viewDir = viewDirectionOf(projectionName);
  const { hidden } = classifyEdges(shape.vertices, shape.faces, shape.edges, viewDir);

  const { points: fitted, scale } = fitToViewBox(projected, { width, height, margin: s.margin });

  const items = [];
  for (const edge of shape.edges) {
    const key = `${edge.a}_${edge.b}`;
    const isHidden = hidden.has(key);
    if (isHidden && hiddenLineMode === 'hidden') continue;
    items.push({
      type: 'line',
      points: [fitted[edge.a], fitted[edge.b]],
      stroke: s.stroke,
      strokeWidth: isHidden ? Math.max(1, s.strokeWidth - 0.5) : s.strokeWidth,
      dash: isHidden,
    });
  }
  return { width, height, background: s.background ?? 'none', items, meta: { scale } };
}

function collectFitPoints(rawPoints2D, ellipses) {
  const pts = [...rawPoints2D];
  for (const e of ellipses) {
    for (let i = 0; i < 32; i++) {
      const t = (2 * Math.PI * i) / 32;
      pts.push(pointOnEllipseParam(e.centerXY, e.A, e.B, t));
    }
  }
  return pts;
}

function computeFit(allPoints, width, height, margin) {
  const xs = allPoints.map((p) => p[0]);
  const ys = allPoints.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const ref = { cx, cy, targetCx: width / 2, targetCy: height / 2 };
  const mapPoint = ([x, y]) => [ref.targetCx + (x - cx) * scale, ref.targetCy - (y - cy) * scale];
  return { scale, mapPoint };
}

function buildCylinderScene(shape, matrix, s, width, height) {
  const bottom = projectCircleToEllipse(matrix, shape.bottomCenter, shape.radius, shape.axis);
  const top = projectCircleToEllipse(matrix, shape.topCenter, shape.radius, shape.axis);
  const fitPoints = collectFitPoints([], [bottom, top]);
  const { scale, mapPoint } = computeFit(fitPoints, width, height, s.margin);

  const [t1, t2] = silhouetteParams(bottom.A, bottom.B);
  const bottomP1 = mapPoint(pointOnEllipseParam(bottom.centerXY, bottom.A, bottom.B, t1));
  const bottomP2 = mapPoint(pointOnEllipseParam(bottom.centerXY, bottom.A, bottom.B, t2));
  const topP1 = mapPoint(pointOnEllipseParam(top.centerXY, top.A, top.B, t1));
  const topP2 = mapPoint(pointOnEllipseParam(top.centerXY, top.A, top.B, t2));

  function mappedEllipse(e) {
    return { cx: mapPoint([e.cx, e.cy])[0], cy: mapPoint([e.cx, e.cy])[1], rx: e.rx * scale, ry: e.ry * scale, rotationDeg: -e.rotationDeg };
  }

  const items = [
    // Back half of the bottom ellipse is hidden by the solid body.
    { type: 'ellipse', ...mappedEllipse(bottom), stroke: s.stroke, strokeWidth: s.strokeWidth, fill: s.fill },
    { type: 'ellipse', ...mappedEllipse(top), stroke: s.stroke, strokeWidth: s.strokeWidth, fill: s.fill },
    { type: 'line', points: [bottomP1, topP1], stroke: s.stroke, strokeWidth: s.strokeWidth },
    { type: 'line', points: [bottomP2, topP2], stroke: s.stroke, strokeWidth: s.strokeWidth },
  ];
  return { width, height, background: s.background ?? 'none', items };
}

function buildConeScene(shape, matrix, s, width, height) {
  const base = projectCircleToEllipse(matrix, shape.baseCenter, shape.radius, shape.axis);
  const apex2d = applyMatrix(matrix, shape.apex);
  const fitPoints = collectFitPoints([apex2d], [base]);
  const { scale, mapPoint } = computeFit(fitPoints, width, height, s.margin);

  const ellipseForTangent = { cx: base.centerXY[0], cy: base.centerXY[1], rx: base.rx, ry: base.ry, rotationDeg: base.rotationDeg };
  const tangents = tangentPointsFromExternalPoint(ellipseForTangent, apex2d) ?? [base.centerXY, base.centerXY];

  const mappedEllipse = {
    cx: mapPoint([base.cx, base.cy])[0],
    cy: mapPoint([base.cx, base.cy])[1],
    rx: base.rx * scale,
    ry: base.ry * scale,
    rotationDeg: -base.rotationDeg,
  };
  const apexMapped = mapPoint(apex2d);

  const items = [
    { type: 'ellipse', ...mappedEllipse, stroke: s.stroke, strokeWidth: s.strokeWidth, fill: s.fill },
    { type: 'line', points: [mapPoint(tangents[0]), apexMapped], stroke: s.stroke, strokeWidth: s.strokeWidth },
    { type: 'line', points: [mapPoint(tangents[1]), apexMapped], stroke: s.stroke, strokeWidth: s.strokeWidth },
  ];
  return { width, height, background: s.background ?? 'none', items };
}
