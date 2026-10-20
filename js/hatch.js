// Hatching (斜線の網掛け) as plain line segments clipped to a polygon. Pure
// functions: no DOM access, so this module is unit-testable under Node.
//
// The hatch is drawn as ordinary <line> elements rather than an SVG <pattern>:
// lines survive every consumer of the exported SVG (Word / PowerPoint import
// <pattern> fills unreliably) and keep a constant spacing on the page however
// large the PNG is rendered.

/**
 * Parallel hatch lines inside `polygon` (even-odd rule), in the polygon's own
 * coordinates (SVG px). Lines run along `angleDeg` measured counter-clockwise
 * on the page (45 = rising to the right) and lie on a grid anchored at the
 * origin, `spacing` apart.
 * @param {[number,number][]} polygon
 * @returns {[[number,number],[number,number]][]} segments
 */
export function hatchSegments(polygon, spacing, angleDeg = 45) {
  if (polygon.length < 3 || !(spacing > 0)) return [];
  // SVG y points down, so a page-counter-clockwise angle is negative here.
  const rad = (-angleDeg * Math.PI) / 180;
  const [c, s] = [Math.cos(rad), Math.sin(rad)];
  // Rotate so the hatch direction becomes the +u axis; then scan lines v = const.
  const toUV = ([x, y]) => [x * c + y * s, -x * s + y * c];
  const fromUV = ([u, v]) => [u * c - v * s, u * s + v * c];
  const pts = polygon.map(toUV);
  const vs = pts.map((p) => p[1]);
  const vMin = Math.min(...vs);
  const vMax = Math.max(...vs);
  const segments = [];
  for (let k = Math.ceil(vMin / spacing); k * spacing <= vMax; k++) {
    const v = k * spacing;
    const us = [];
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [ui, vi] = pts[i];
      const [uj, vj] = pts[j];
      // Half-open rule: a vertex exactly on the scan line is counted once.
      if (vi <= v !== vj <= v) us.push(ui + ((v - vi) * (uj - ui)) / (vj - vi));
    }
    us.sort((a, b) => a - b);
    for (let i = 0; i + 1 < us.length; i += 2) {
      if (us[i + 1] - us[i] > 1e-9) segments.push([fromUV([us[i], v]), fromUV([us[i + 1], v])]);
    }
  }
  return segments;
}
