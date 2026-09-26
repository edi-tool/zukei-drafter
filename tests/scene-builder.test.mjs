import test from 'node:test';
import assert from 'node:assert/strict';
import { regularPolygon } from '../js/geometry2d.js';
import { buildScene2D, buildScene3D } from '../js/scene-builder.js';
import { renderSvgString } from '../js/render-svg.js';

test('buildScene2D + renderSvgString produces a well-formed SVG for a regular polygon', () => {
  const { points } = regularPolygon({ sides: 5, sideLength: 20 });
  const scene = buildScene2D(points, true, { width: 400, height: 400 });
  const svg = renderSvgString(scene);
  assert.match(svg, /^<svg /);
  assert.match(svg, /<polygon points="/);
  assert.match(svg, /<\/svg>$/);
});

test('buildScene3D: cube renders 12 line segments with some hidden (dashed)', () => {
  const scene = buildScene3D('cube', { size: 40 }, 'isometric', {}, { width: 500, height: 500, hiddenLineMode: 'dashed' });
  assert.equal(scene.items.length, 12);
  assert.ok(scene.items.some((it) => it.dash === true));
  assert.ok(scene.items.some((it) => it.dash === false || it.dash === undefined));
  const svg = renderSvgString(scene);
  assert.match(svg, /stroke-dasharray/);
});

test('buildScene3D: hiddenLineMode "hidden" omits hidden edges entirely', () => {
  const scene = buildScene3D('cube', { size: 40 }, 'isometric', {}, { width: 500, height: 500, hiddenLineMode: 'hidden' });
  assert.ok(scene.items.length < 12);
  assert.ok(scene.items.every((it) => !it.dash));
});

test('buildScene3D: cylinder renders two ellipses and two silhouette lines', () => {
  const scene = buildScene3D('cylinder', { radius: 20, height: 50 }, 'cavalier', {}, { width: 400, height: 400 });
  const ellipses = scene.items.filter((it) => it.type === 'ellipse');
  const lines = scene.items.filter((it) => it.type === 'line');
  assert.equal(ellipses.length, 2);
  assert.equal(lines.length, 2);
  const svg = renderSvgString(scene);
  assert.match(svg, /<ellipse/);
});

test('buildScene3D: cone renders one ellipse and two tangent lines to the apex', () => {
  const scene = buildScene3D('cone', { radius: 20, height: 50 }, 'oblique', { angleDeg: 30, scale: 0.6 }, { width: 400, height: 400 });
  const ellipses = scene.items.filter((it) => it.type === 'ellipse');
  const lines = scene.items.filter((it) => it.type === 'line');
  assert.equal(ellipses.length, 1);
  assert.equal(lines.length, 2);
});
