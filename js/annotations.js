// Dimension / annotation layout for 2D figures: vertex names, edge lengths
// (plain labels or dimension lines with arrows) and interior angles (arc +
// label). Pure functions: no DOM access, so this module is unit-testable
// under Node.
//
// Values (lengths, angles) are computed from the logical points; placement is
// done in SVG pixel space on the mapped points so that gaps, arrow sizes and
// font sizes are constant on the page regardless of the figure's scale. The
// logical -> SVG map of computeFit is a uniform scale plus a y flip, so angles
// and length ratios are the same in both spaces.
//
// Text boxes are estimated from per-character advance widths (no DOM text
// measurement), which keeps layout deterministic under Node. The estimates are
// deliberately a little generous; tests/e2e compares them with the browser's
// real text metrics.

const DEFAULTS = {
  vertexNames: false,
  lengths: 'none', // 'none' | 'label' | 'dimension'
  angles: false,
  unit: '',
  decimals: 1,
  fontSize: 18,
  color: '#111111',
  strokeWidth: 2,
};

/** Baseline sits this many em below the visual center of digits/capitals. */
const BASELINE_SHIFT = 0.36;
/** Height of the estimated text box, in em. */
const BOX_HEIGHT = 1.0;

export function hasAnnotations(options) {
  if (!options) return false;
  return Boolean(options.vertexNames || options.angles || (options.lengths && options.lengths !== 'none'));
}

/** Fixed decimals, then trailing zeros dropped: (40, 1) -> "40", (36.87, 1) -> "36.9". */
export function formatNumber(value, decimals) {
  let s = value.toFixed(decimals);
  if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
}

/** A, B, ..., Z, then A1, B1, ... */
export function vertexName(i) {
  const letter = String.fromCharCode(65 + (i % 26));
  const round = Math.floor(i / 26);
  return round === 0 ? letter : `${letter}${round}`;
}

function charAdvance(ch) {
  if (/[0-9]/.test(ch)) return 0.56;
  if (ch === '.' || ch === ',') return 0.3;
  if (ch === '°') return 0.42;
  if (ch === ' ') return 0.3;
  if (/[A-Z]/.test(ch)) return 0.74;
  if (/[a-z]/.test(ch)) return 0.58;
  if (ch.charCodeAt(0) < 128) return 0.62;
  return 1.0; // CJK and other full-width characters
}

/** Estimated size of a text box in px (width from advance widths, height one em). */
export function estimateTextBox(text, fontSize) {
  let em = 0;
  for (const ch of text) em += charAdvance(ch);
  return { width: em * fontSize, height: BOX_HEIGHT * fontSize };
}

// ---------- small vector helpers (pixel space) ----------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const norm = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n] : [0, 0];
};

/** Shoelace signed area (positive when the interior is on the left of each edge). */
export function signedArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    sum += cross(points[i], points[(i + 1) % points.length]);
  }
  return sum / 2;
}

/** Support of an axis-aligned box of half-size (hw, hh) in direction d. */
function support(hw, hh, d) {
  return hw * Math.abs(d[0]) + hh * Math.abs(d[1]);
}

/**
 * Center of a text box placed from vertex `v` along unit direction `d`,
 * at least `radius + gap` away from v and, when the box sits inside a wedge
 * bounded by the rays `rays` (half-angle < 90deg), at least `gap` away from
 * both ray lines.
 */
export function placeInWedge(v, d, rays, radius, box, gap) {
  const hw = box.width / 2;
  const hh = box.height / 2;
  let t = radius + gap + support(hw, hh, d);
  for (const r of rays) {
    const cosHalf = dot(d, r);
    if (cosHalf <= 0) continue; // ray points away: the vertex itself is the nearest point
    const sinHalf = Math.abs(cross(r, d));
    if (sinHalf < 1e-9) continue;
    const n = unit(sub(d, mul(r, cosHalf))); // normal of the ray line, towards d
    t = Math.max(t, (support(hw, hh, n) + gap) / sinHalf);
  }
  return add(v, mul(d, t));
}

/**
 * Per-vertex angle data in any coordinate system. For an open path the end
 * vertices have no angle (null). `interiorDeg` is measured on the polygon's
 * interior side (taken from the signed area, also for an open path), so it can
 * exceed 180 at a reflex vertex.
 */
export function vertexAngles(points, closed) {
  const n = points.length;
  const orient = signedArea(points) >= 0 ? 1 : -1;
  const result = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) {
      result.push(null);
      continue;
    }
    const v = points[i];
    const prev = points[(i - 1 + n) % n];
    const next = points[(i + 1) % n];
    const e1 = unit(sub(prev, v));
    const e2 = unit(sub(next, v));
    const between = Math.acos(Math.max(-1, Math.min(1, dot(e1, e2))));
    const c = cross(e1, e2);
    const sum = add(e1, e2);
    let bisector;
    let interior;
    if (norm(sum) < 1e-9) {
      // Straight angle: the interior side is left of the travel direction (for positive orientation).
      const travel = sub(next, prev);
      bisector = unit(mul([-travel[1], travel[0]], orient));
      interior = Math.PI;
    } else {
      const convex = orient * c < 0;
      bisector = mul(unit(sum), convex ? 1 : -1);
      interior = convex ? between : 2 * Math.PI - between;
    }
    result.push({ e1, e2, bisector, interiorDeg: (interior * 180) / Math.PI });
  }
  return result;
}

/** Even-odd ray casting. */
export function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function textItem(center, text, o) {
  return {
    type: 'text',
    x: center[0],
    y: center[1] + BASELINE_SHIFT * o.fontSize,
    text,
    fontSize: o.fontSize,
    fill: o.color,
  };
}

function rectOf(center, box, grow = 0) {
  return {
    minX: center[0] - box.width / 2 - grow,
    maxX: center[0] + box.width / 2 + grow,
    minY: center[1] - box.height / 2 - grow,
    maxY: center[1] + box.height / 2 + grow,
  };
}

const rectsOverlap = (a, b) => a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;

/** Liang-Barsky: does segment pq touch the rectangle? */
export function segmentHitsRect(p, q, r) {
  let t0 = 0;
  let t1 = 1;
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  const clip = (den, num) => {
    if (den === 0) return num >= 0;
    const t = num / den;
    if (den > 0) {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    } else {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    }
    return true;
  };
  return (
    clip(-dx, p[0] - r.minX) && clip(dx, r.maxX - p[0]) && clip(-dy, p[1] - r.minY) && clip(dy, r.maxY - p[1]) && t0 <= t1
  );
}

/**
 * Collision-aware label placement. Obstacles are line segments (figure edges,
 * dimension lines, angle arcs as chords) and the boxes of labels placed
 * before. A label starts at its analytic position and moves outward along its
 * direction in 1px steps until it is clear; if nothing clears within a
 * generous distance it stays at the start (never lost, just overlapping).
 */
class Placer {
  constructor(clearance) {
    this.clearance = clearance;
    this.segments = [];
    this.rects = [];
  }

  addSegment(p, q) {
    this.segments.push([p, q]);
  }

  isFree(center, box) {
    const r = rectOf(center, box, this.clearance);
    return !this.segments.some(([p, q]) => segmentHitsRect(p, q, r)) && !this.rects.some((o) => rectsOverlap(r, o));
  }

  /** First clear center along the ray within `maxTravel` (and satisfying `accept`), or null. */
  find(start, dir, box, maxTravel, accept = () => true) {
    for (let t = 0; t <= maxTravel; t += 1) {
      const c = add(start, mul(dir, t));
      if (!accept(c)) return null;
      if (this.isFree(c, box)) return c;
    }
    return null;
  }

  commit(center, box) {
    this.rects.push(rectOf(center, box));
    return center;
  }
}

/**
 * @param {[number,number][]} points logical vertices (y up)
 * @param {boolean} closed false for an open general polygon (polyline)
 * @param {(p:[number,number]) => [number,number]} map logical -> SVG px (computeFit(...).map)
 * @param {object} options see DEFAULTS
 * @returns {{items: object[], bounds: {minX,maxX,minY,maxY}|null, labels: {text, center, box}[]}}
 *   scene items to draw above the figure, the px bounding box of everything
 *   they cover (text boxes estimated), and the placed text boxes.
 */
export function annotate2D(points, closed, map, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const px = points.map(map);
  const n = px.length;
  const edgeCount = closed ? n : n - 1;
  const lineItems = [];
  const labels = [];
  const covered = [];
  const lineWidth = Math.max(0.75, o.strokeWidth * 0.6);
  const gap = o.fontSize * 0.3;
  const maxTravel = o.fontSize * 20;
  const orient = signedArea(px) >= 0 ? 1 : -1;
  const placer = new Placer(Math.max(2, o.strokeWidth / 2 + 1));
  const showLengths = o.lengths === 'label' || o.lengths === 'dimension';
  const dimOffset = o.lengths === 'dimension' ? o.fontSize * 0.9 : 0;

  const addLine = (p, q) => {
    lineItems.push({ type: 'line', points: [p, q], stroke: o.color, strokeWidth: lineWidth });
    placer.addSegment(p, q);
    covered.push(p, q);
  };
  const addLabelAt = (center, text, box) => {
    placer.commit(center, box);
    labels.push({ text, center, box });
    const r = rectOf(center, box);
    covered.push([r.minX, r.minY], [r.maxX, r.maxY]);
  };
  const addLabel = (start, dir, text, box) => addLabelAt(placer.find(start, dir, box, maxTravel) ?? start, text, box);

  for (let i = 0; i < edgeCount; i++) placer.addSegment(px[i], px[(i + 1) % n]);

  // Edge geometry (px) and dimension lines. Labels come last so that they
  // yield to vertex names and angle values, which are tied to a point.
  const edges = [];
  if (showLengths) {
    for (let i = 0; i < edgeCount; i++) {
      const j = (i + 1) % n;
      const p = px[i];
      const q = px[j];
      const u = unit(sub(q, p));
      const outward = mul([-u[1], u[0]], -orient);
      const length = Math.hypot(points[j][0] - points[i][0], points[j][1] - points[i][1]);
      edges.push({ p, q, u, outward, text: formatNumber(length, o.decimals) + o.unit });
      if (o.lengths === 'dimension') {
        const extGap = 3;
        const overshoot = 3;
        const p2 = add(p, mul(outward, dimOffset));
        const q2 = add(q, mul(outward, dimOffset));
        addLine(add(p, mul(outward, extGap)), add(p, mul(outward, dimOffset + overshoot)));
        addLine(add(q, mul(outward, extGap)), add(q, mul(outward, dimOffset + overshoot)));
        addLine(p2, q2);
        const al = Math.max(6, o.fontSize * 0.45);
        const aw = al * 0.35;
        for (const [tip, dir] of [[p2, u], [q2, mul(u, -1)]]) {
          const base = add(tip, mul(dir, al));
          const side = mul([-dir[1], dir[0]], aw);
          lineItems.push({ type: 'polygon', points: [tip, add(base, side), sub(base, side)], stroke: 'none', strokeWidth: 0, fill: o.color });
        }
      }
    }
  }

  const angles = vertexAngles(px, closed);

  // Interior angle arcs
  const arcs = [];
  if (o.angles) {
    for (let i = 0; i < n; i++) {
      const a = angles[i];
      if (!a) continue;
      const v = px[i];
      const prevLen = norm(sub(px[(i - 1 + n) % n], v));
      const nextLen = norm(sub(px[(i + 1) % n], v));
      const radius = Math.min(o.fontSize * 1.3, 0.35 * Math.min(prevLen, nextLen));
      const start = add(v, mul(a.e1, radius));
      const end = add(v, mul(a.e2, radius));
      const largeArc = a.interiorDeg > 180 ? 1 : 0;
      const sweep = cross(a.e1, a.bisector) > 0 ? 1 : 0;
      const f = (p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
      lineItems.push({
        type: 'path',
        d: `M${f(start)} A${radius.toFixed(2)},${radius.toFixed(2)} 0 ${largeArc} ${sweep} ${f(end)}`,
        fill: 'none',
        stroke: o.color,
        strokeWidth: lineWidth,
      });
      // Arc samples: its bounds, and chords as obstacles for labels.
      const startAngle = Math.atan2(a.e1[1], a.e1[0]);
      const span = ((a.interiorDeg * Math.PI) / 180) * (sweep ? 1 : -1);
      let prev = null;
      for (let k = 0; k <= 12; k++) {
        const t = startAngle + (span * k) / 12;
        const p = add(v, [radius * Math.cos(t), radius * Math.sin(t)]);
        covered.push(p);
        if (prev) placer.addSegment(prev, p);
        prev = p;
      }
      arcs.push({ i, radius });
    }
  }

  // Angle values inside the angle. Sliding along the bisector must not carry
  // a value across the figure (it would read as another corner's angle), so
  // when the angle is too cramped the value goes just outside its vertex.
  const inside = closed ? (c) => pointInPolygon(c, px) : () => true;
  for (const { i, radius } of arcs) {
    const a = angles[i];
    const text = formatNumber(a.interiorDeg, o.decimals) + '°';
    const box = estimateTextBox(text, o.fontSize);
    const rays = a.interiorDeg < 180 ? [a.e1, a.e2] : [];
    const start = placeInWedge(px[i], a.bisector, rays, radius, box, gap);
    let center = placer.find(start, a.bisector, box, maxTravel, inside);
    if (!center) {
      const out = mul(a.bisector, -1);
      const outStart = placeInWedge(px[i], out, a.interiorDeg > 180 ? [a.e1, a.e2] : [], 0, box, gap);
      center = placer.find(outStart, out, box, maxTravel) ?? outStart;
    }
    addLabelAt(center, text, box);
  }

  // Vertex names outside the figure, along the exterior bisector
  if (o.vertexNames) {
    for (let i = 0; i < n; i++) {
      const v = px[i];
      const text = vertexName(i);
      const box = estimateTextBox(text, o.fontSize);
      const a = angles[i];
      let dir;
      let rays = [];
      if (a) {
        dir = mul(a.bisector, -1);
        if (a.interiorDeg > 180) rays = [a.e1, a.e2];
      } else {
        // End of an open path: continue past the only neighbor.
        dir = unit(sub(v, px[i === 0 ? 1 : n - 2]));
      }
      addLabel(placeInWedge(v, dir, rays, 0, box, gap), dir, text, box);
    }
  }

  // Edge lengths outside the figure (beyond the dimension line, if any)
  for (const e of edges) {
    const box = estimateTextBox(e.text, o.fontSize);
    const mid = mul(add(e.p, e.q), 0.5);
    const start = add(mid, mul(e.outward, dimOffset + gap + support(box.width / 2, box.height / 2, e.outward)));
    addLabel(start, e.outward, e.text, box);
  }

  const items = [...lineItems, ...labels.map((l) => textItem(l.center, l.text, o))];
  let bounds = null;
  for (const [x, y] of covered) {
    bounds ??= { minX: x, maxX: x, minY: y, maxY: y };
    bounds.minX = Math.min(bounds.minX, x);
    bounds.maxX = Math.max(bounds.maxX, x);
    bounds.minY = Math.min(bounds.minY, y);
    bounds.maxY = Math.max(bounds.maxY, y);
  }
  return { items, bounds, labels };
}
