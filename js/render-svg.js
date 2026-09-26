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

// System fonts only: an external web font would not load inside an SVG drawn
// as an <img> (and could taint the canvas), so PNG export relies on local fonts.
export const FONT_FAMILY = "Helvetica, Arial, 'Hiragino Sans', 'Yu Gothic', Meiryo, 'Noto Sans CJK JP', sans-serif";

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
    case 'text': {
      // (x, y) is the baseline anchor; text-anchor centers it horizontally.
      return `<text x="${item.x.toFixed(2)}" y="${item.y.toFixed(2)}" font-family="${escapeAttr(item.fontFamily ?? FONT_FAMILY)}" font-size="${item.fontSize}" fill="${escapeAttr(item.fill ?? '#111111')}" text-anchor="middle">${escapeText(item.text)}</text>`;
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
