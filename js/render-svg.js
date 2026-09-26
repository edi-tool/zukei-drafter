// Builds SVG markup (as a string) from a plain-data "scene" description.
// Kept string-based (rather than direct DOM manipulation) so it can be unit
// tested under Node and so the exact markup fed into PNG export is known.
// Presentation attributes are written explicitly (not via CSS classes) so the
// look survives serialization into a rasterized <img> during PNG export.

const SVG_NS = 'http://www.w3.org/2000/svg';

function escapeAttr(value) {
  return String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// System-only font stack: no external/web fonts, so PNG export (Canvas) never
// depends on a font that might fail to load or taint the canvas.
const TEXT_FONT_FAMILY = '-apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", Arial, sans-serif';

function styleAttrs({ stroke = '#111111', strokeWidth = 2, fill = 'none', dash = false }) {
  const attrs = [
    `stroke="${escapeAttr(stroke)}"`,
    `stroke-width="${strokeWidth}"`,
    `fill="${escapeAttr(fill)}"`,
    'stroke-linejoin="round"',
    'stroke-linecap="round"',
  ];
  if (dash) attrs.push(`stroke-dasharray="${Math.max(4, strokeWidth * 3)},${Math.max(3, strokeWidth * 2)}"`);
  return attrs.join(' ');
}

function renderItem(item) {
  switch (item.type) {
    case 'polygon': {
      const pts = item.points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
      return `<polygon points="${pts}" ${styleAttrs(item)} />`;
    }
    case 'polyline': {
      const pts = item.points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
      return `<polyline points="${pts}" ${styleAttrs({ ...item, fill: 'none' })} />`;
    }
    case 'line': {
      const [[x1, y1], [x2, y2]] = item.points;
      return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" ${styleAttrs({ ...item, fill: 'none' })} />`;
    }
    case 'path': {
      return `<path d="${item.d}" ${styleAttrs(item)} />`;
    }
    case 'ellipse': {
      const { cx, cy, rx, ry } = item;
      return `<ellipse cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" rx="${rx.toFixed(2)}" ry="${ry.toFixed(2)}" ${styleAttrs(item)} />`;
    }
    case 'text': {
      const [x, y] = item.point;
      const fontSize = item.fontSize ?? 14;
      const anchor = item.anchor ?? 'middle';
      const rotation = item.rotation ? ` transform="rotate(${item.rotation.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)})"` : '';
      // No dedicated CSS baseline needed: dominant-baseline="central" plus a
      // fixed dy nudge keeps digits/letters visually centered across the
      // browsers this app targets, without relying on font metrics.
      return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" dy="0.35em" font-size="${fontSize}" font-family="${escapeAttr(TEXT_FONT_FAMILY)}" text-anchor="${escapeAttr(anchor)}" fill="${escapeAttr(item.color ?? '#111111')}" stroke="none"${rotation}>${escapeText(item.text)}</text>`;
    }
    default:
      throw new RangeError(`unknown scene item type: ${item.type}`);
  }
}

/**
 * @param {{width:number, height:number, background?:string, items:object[]}} scene
 * @returns {string} standalone SVG markup
 */
export function renderSvgString(scene) {
  const { width, height, background = 'none', items } = scene;
  const bg =
    background && background !== 'none'
      ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${escapeAttr(background)}" />`
      : '';
  const body = items.map(renderItem).join('\n  ');
  return `<svg xmlns="${SVG_NS}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">\n  ${bg}\n  ${body}\n</svg>`;
}
