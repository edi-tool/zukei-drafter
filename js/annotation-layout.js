// Converts the pure geometry from js/annotations.js into scene items
// (text / line / polyline) already mapped into SVG pixel space via the same
// `fit.map` affine transform used for the shape itself.
//
// This module is the "annotation calculation" stage in the data flow:
//   geometry -> annotation calculation (this file, using annotations.js) -> scene items -> SVG renderer
// It never emits SVG markup itself (that stays in render-svg.js), and it
// never derives lengths/angles from pixel coordinates: `points` here are the
// same logical-space points passed to buildScene2D, so lengths/angles come
// straight from the geometry, not from anything measured on screen.

import {
  vertexOutwardDirections,
  edgeGeometry,
  interiorAngles,
  isRightAngle,
  vertexLabelLetters,
  formatLength,
  formatAngle,
  pixelsToLogical,
} from './annotations.js';

export const DEFAULT_ANNOTATIONS = {
  vertexLabels: { enabled: false, fontSize: 16, distance: 14 },
  edgeLengths: { mode: 'off', unit: 'none', decimals: 0, fontSize: 14, offset: 26 },
  angles: { enabled: false, showValue: true, decimals: 0, radius: 24, fontSize: 13 },
  rightAngles: { mode: 'hidden' },
};

export function normalizeAnnotations(options = {}) {
  return {
    vertexLabels: { ...DEFAULT_ANNOTATIONS.vertexLabels, ...options.vertexLabels },
    edgeLengths: { ...DEFAULT_ANNOTATIONS.edgeLengths, ...options.edgeLengths },
    angles: { ...DEFAULT_ANNOTATIONS.angles, ...options.angles },
    rightAngles: { ...DEFAULT_ANNOTATIONS.rightAngles, ...options.rightAngles },
  };
}

/** Any annotation category turned on? Lets callers skip the whole pass cheaply. */
export function annotationsActive(options) {
  const a = normalizeAnnotations(options);
  return a.vertexLabels.enabled || a.edgeLengths.mode !== 'off' || a.angles.enabled || a.rightAngles.mode === 'auto';
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

function expandBBox(bbox, extra) {
  return {
    minX: Math.min(bbox.minX, extra.minX),
    maxX: Math.max(bbox.maxX, extra.maxX),
    minY: Math.min(bbox.minY, extra.minY),
    maxY: Math.max(bbox.maxY, extra.maxY),
  };
}

// Approximate a text item's on-screen footprint without a DOM/canvas
// measureText call (the renderer must stay usable under plain Node). Sans-
// serif glyphs at typical teaching-material font sizes average well under
// one em of advance width, so 0.62em/character is a safe-but-not-wasteful
// estimate; rotated text is bounded by a circle of the same diagonal so the
// approximation stays valid at any rotation without doing a full rect
// rotation. This is documented here rather than tuned further because a
// DOM-free exact measurement is not possible; see ARCHITECTURE.md.
function textBBox(item) {
  const w = Math.max(item.fontSize, item.text.length * item.fontSize * 0.62);
  const h = item.fontSize * 1.25;
  const [x, y] = item.point;
  if (!item.rotation) {
    return { minX: x - w / 2, maxX: x + w / 2, minY: y - h / 2, maxY: y + h / 2 };
  }
  const r = Math.hypot(w, h) / 2;
  return { minX: x - r, maxX: x + r, minY: y - r, maxY: y + r };
}

function itemBBox(item) {
  if (item.type === 'text') return textBBox(item);
  return bboxOfPoints(item.points);
}

function upright(dx, dy) {
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg > 90 || deg < -90) deg += 180;
  return deg;
}

function angleNear(a, b, eps = 1e-4) {
  const diff = (((a - b + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
  return Math.abs(diff) < eps;
}

/**
 * @param {[number,number][]} points logical-space vertices (same as passed to buildScene2D)
 * @param {boolean} closed
 * @param {{map:(p:[number,number])=>[number,number], scale:number}} fit
 * @param {object} options see DEFAULT_ANNOTATIONS
 * @returns {{items:object[], bbox:{minX:number,maxX:number,minY:number,maxY:number}|null}}
 */
export function buildAnnotationItems(points, closed, fit, options, textColor = '#111111') {
  const opts = normalizeAnnotations(options);
  const items = [];
  const scale = fit.scale;
  const toLogical = (px) => pixelsToLogical(px, scale);

  if (opts.vertexLabels.enabled && points.length >= 1) {
    const dirs = vertexOutwardDirections(points, closed);
    const letters = vertexLabelLetters(points.length);
    const distLogical = toLogical(opts.vertexLabels.distance);
    points.forEach((p, i) => {
      const anchor = [p[0] + dirs[i][0] * distLogical, p[1] + dirs[i][1] * distLogical];
      items.push({
        type: 'text',
        point: fit.map(anchor),
        text: letters[i],
        fontSize: opts.vertexLabels.fontSize,
        anchor: 'middle',
        baseline: 'middle',
        color: textColor,
      });
    });
  }

  const edgeMode = opts.edgeLengths.mode;
  if (edgeMode !== 'off') {
    const edges = edgeGeometry(points, closed);
    const textGapLogical = toLogical(opts.edgeLengths.fontSize * 0.9);
    for (const edge of edges) {
      const text = formatLength(edge.length, opts.edgeLengths.unit, opts.edgeLengths.decimals);
      const p1Pixel = fit.map(edge.from);
      const p2Pixel = fit.map(edge.to);
      const rotation = upright(p2Pixel[0] - p1Pixel[0], p2Pixel[1] - p1Pixel[1]);

      if (edgeMode === 'text') {
        const anchor = [
          edge.midpoint[0] + edge.normal[0] * textGapLogical,
          edge.midpoint[1] + edge.normal[1] * textGapLogical,
        ];
        items.push({
          type: 'text',
          point: fit.map(anchor),
          text,
          fontSize: opts.edgeLengths.fontSize,
          anchor: 'middle',
          baseline: 'middle',
          rotation,
          color: textColor,
        });
      } else {
        // Dimension line: extension lines from the edge out to the offset
        // line, the offset line itself with small arrowhead ticks, and the
        // length text centered a little further out again.
        const offsetLogical = toLogical(opts.edgeLengths.offset);
        const extTip = offsetLogical * 1.15;
        const d1 = [edge.from[0] + edge.normal[0] * offsetLogical, edge.from[1] + edge.normal[1] * offsetLogical];
        const d2 = [edge.to[0] + edge.normal[0] * offsetLogical, edge.to[1] + edge.normal[1] * offsetLogical];
        const ext1End = [edge.from[0] + edge.normal[0] * extTip, edge.from[1] + edge.normal[1] * extTip];
        const ext2End = [edge.to[0] + edge.normal[0] * extTip, edge.to[1] + edge.normal[1] * extTip];
        items.push({ type: 'line', points: [fit.map(edge.from), fit.map(ext1End)], stroke: textColor, strokeWidth: 1 });
        items.push({ type: 'line', points: [fit.map(edge.to), fit.map(ext2End)], stroke: textColor, strokeWidth: 1 });
        const d1Pixel = fit.map(d1);
        const d2Pixel = fit.map(d2);
        items.push({ type: 'line', points: [d1Pixel, d2Pixel], stroke: textColor, strokeWidth: 1 });
        // Arrowhead ticks: short "V" at each end of the dimension line, along its own direction.
        const dimDir = [d2Pixel[0] - d1Pixel[0], d2Pixel[1] - d1Pixel[1]];
        const dimLen = Math.hypot(dimDir[0], dimDir[1]) || 1;
        const u = [dimDir[0] / dimLen, dimDir[1] / dimLen];
        const perp = [-u[1], u[0]];
        const tick = Math.max(4, opts.edgeLengths.fontSize * 0.35);
        for (const [origin, dirSign] of [[d1Pixel, 1], [d2Pixel, -1]]) {
          const tail = [origin[0] + u[0] * dirSign * tick, origin[1] + u[1] * dirSign * tick];
          items.push({ type: 'line', points: [[tail[0] + perp[0] * tick * 0.5, tail[1] + perp[1] * tick * 0.5], origin], stroke: textColor, strokeWidth: 1 });
          items.push({ type: 'line', points: [[tail[0] - perp[0] * tick * 0.5, tail[1] - perp[1] * tick * 0.5], origin], stroke: textColor, strokeWidth: 1 });
        }
        const midLogical = [(d1[0] + d2[0]) / 2, (d1[1] + d2[1]) / 2];
        const textAnchor = [midLogical[0] + edge.normal[0] * textGapLogical, midLogical[1] + edge.normal[1] * textGapLogical];
        items.push({
          type: 'text',
          point: fit.map(textAnchor),
          text,
          fontSize: opts.edgeLengths.fontSize,
          anchor: 'middle',
          baseline: 'middle',
          rotation,
          color: textColor,
        });
      }
    }
  }

  if (closed && points.length >= 3 && (opts.angles.enabled || opts.rightAngles.mode === 'auto')) {
    const angles = interiorAngles(points);
    const radiusLogical = toLogical(opts.angles.radius);
    const markLogical = radiusLogical * 0.55;
    const textGapLogical = toLogical(opts.angles.fontSize * 1.1);
    for (const a of angles) {
      const right = isRightAngle(a.angleDeg);
      if (right && opts.rightAngles.mode === 'auto') {
        const p1 = [a.vertex[0] + a.dirToPrev[0] * markLogical, a.vertex[1] + a.dirToPrev[1] * markLogical];
        const p2 = [p1[0] + a.dirToNext[0] * markLogical, p1[1] + a.dirToNext[1] * markLogical];
        const p3 = [a.vertex[0] + a.dirToNext[0] * markLogical, a.vertex[1] + a.dirToNext[1] * markLogical];
        items.push({
          type: 'polyline',
          points: [p1, p2, p3].map(fit.map),
          stroke: textColor,
          strokeWidth: 1.25,
        });
        continue; // The square already communicates the right angle; skip the arc for this vertex.
      }
      if (!opts.angles.enabled) continue;

      const a1 = Math.atan2(a.dirToPrev[1], a.dirToPrev[0]);
      const a2 = Math.atan2(a.dirToNext[1], a.dirToNext[0]);
      const interiorRad = (a.angleDeg * Math.PI) / 180;
      const sweep = angleNear(a1 + interiorRad, a2) ? interiorRad : -interiorRad;
      const steps = 24;
      const arcPoints = [];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const ang = a1 + sweep * t;
        arcPoints.push(fit.map([a.vertex[0] + Math.cos(ang) * radiusLogical, a.vertex[1] + Math.sin(ang) * radiusLogical]));
      }
      items.push({ type: 'polyline', points: arcPoints, stroke: textColor, strokeWidth: 1.25, fill: 'none' });

      if (opts.angles.showValue) {
        const midAng = a1 + sweep / 2;
        const labelR = radiusLogical + textGapLogical;
        const anchor = [a.vertex[0] + Math.cos(midAng) * labelR, a.vertex[1] + Math.sin(midAng) * labelR];
        items.push({
          type: 'text',
          point: fit.map(anchor),
          text: formatAngle(a.angleDeg, opts.angles.decimals),
          fontSize: opts.angles.fontSize,
          anchor: 'middle',
          baseline: 'middle',
          color: textColor,
        });
      }
    }
  }

  if (items.length === 0) return { items, bbox: null };
  let bbox = itemBBox(items[0]);
  for (let i = 1; i < items.length; i++) bbox = expandBBox(bbox, itemBBox(items[i]));
  return { items, bbox };
}
