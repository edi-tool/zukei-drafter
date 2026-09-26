import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSvgString } from '../js/render-svg.js';

test('renderSvgString: text item produces a well-formed <text> element', () => {
  const scene = {
    width: 100,
    height: 100,
    items: [{ type: 'text', point: [10, 20], text: 'A', fontSize: 16, anchor: 'middle', color: '#111111' }],
  };
  const svg = renderSvgString(scene);
  assert.match(svg, /<text x="10.00" y="20.00"[^>]*>A<\/text>/);
});

test('renderSvgString: font-family with embedded double quotes does not break the attribute (regression)', () => {
  const scene = {
    width: 100,
    height: 100,
    items: [{ type: 'text', point: [0, 0], text: '5 cm', fontSize: 14 }],
  };
  const svg = renderSvgString(scene);
  // A raw, unescaped '"' inside the font-family value would terminate the
  // attribute early and produce invalid XML (the SVG would then fail to
  // load as an <img>, breaking PNG export). Embedded quotes must come
  // through as &quot; instead.
  const fontFamilyAttr = svg.match(/font-family="([^]*?)"\s+text-anchor/)[1];
  assert.ok(!fontFamilyAttr.includes('"'), `font-family attribute must not contain a raw double quote: ${fontFamilyAttr}`);
  assert.ok(fontFamilyAttr.includes('&quot;'), 'embedded quotes should be escaped as &quot;');
});

test('renderSvgString: text content is XML-escaped', () => {
  const scene = { width: 10, height: 10, items: [{ type: 'text', point: [0, 0], text: '<3 & "ok"' }] };
  const svg = renderSvgString(scene);
  assert.ok(!svg.includes('<3'));
  assert.match(svg, /&lt;3 &amp; "ok"/);
});

test('renderSvgString: rotated text includes a rotate() transform around its own anchor', () => {
  const scene = { width: 10, height: 10, items: [{ type: 'text', point: [5, 5], text: 'x', rotation: 45 }] };
  const svg = renderSvgString(scene);
  assert.match(svg, /transform="rotate\(45\.00 5\.00 5\.00\)"/);
});

test('renderSvgString: ellipse item renders cx/cy/rx/ry', () => {
  const scene = { width: 10, height: 10, items: [{ type: 'ellipse', cx: 5, cy: 5, rx: 3, ry: 2 }] };
  const svg = renderSvgString(scene);
  assert.match(svg, /<ellipse cx="5.00" cy="5.00" rx="3.00" ry="2.00"/);
});
