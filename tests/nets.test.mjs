import test from 'node:test';
import assert from 'node:assert/strict';
import { boxNet, cubeNet, cylinderNet, coneNet } from '../js/nets.js';
import { buildSceneNet } from '../js/scene-builder.js';
import { renderSvgString } from '../js/render-svg.js';

const area = (poly) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const [p, q] = [poly[i], poly[(i + 1) % poly.length]];
    s += p[0] * q[1] - q[0] * p[1];
  }
  return Math.abs(s) / 2;
};

test('box net: six faces with the surface area of the cuboid, five folds', () => {
  const net = boxNet({ width: 50, height: 40, depth: 30 });
  assert.ok(net.ok);
  assert.equal(net.faces.length, 6);
  const total = net.faces.reduce((sum, f) => sum + area(f), 0);
  assert.equal(total, 2 * (50 * 40 + 40 * 30 + 50 * 30));
  // A net of 6 faces is a tree of 5 shared edges; the rest is the cut outline.
  assert.equal(net.lines.filter((l) => l.fold).length, 5);
  assert.equal(net.lines.filter((l) => !l.fold).length, 6 * 4 - 2 * 5);
  assert.deepEqual(net.dims.map((d) => [d.key, d.value]), [['width', 50], ['depth', 30], ['height', 40]]);
  assert.equal(boxNet({ width: 1, height: 0, depth: 1 }).ok, false);
});

test('cube net: a single length label', () => {
  const net = cubeNet({ size: 40 });
  assert.ok(net.ok);
  assert.equal(net.dims.length, 1);
  assert.equal(cubeNet({ size: -1 }).ok, false);
});

test('cylinder net: side width is the circumference with the chosen π, bases touch the side', () => {
  const net = cylinderNet({ radius: 10, height: 30, pi: 3.14 });
  assert.ok(net.ok);
  const [rect] = net.faces;
  const width = Math.max(...rect.map((p) => p[0])) - Math.min(...rect.map((p) => p[0]));
  assert.ok(Math.abs(width - 62.8) < 1e-9);
  const [top, bottom] = net.circles;
  assert.equal(top.center[1] - top.radius, 30);
  assert.equal(bottom.center[1] + bottom.radius, 0);
  assert.ok(Math.abs(cylinderNet({ radius: 1, height: 1 }).dims[0].value - 2 * Math.PI) < 1e-12);
});

test('cone net: arc length of the sector equals the base circumference', () => {
  const net = coneNet({ radius: 10, slant: 30 });
  assert.ok(net.ok);
  const [s] = net.sectors;
  assert.ok(Math.abs(s.endDeg - s.startDeg - 120) < 1e-9);
  const arc = ((s.endDeg - s.startDeg) * Math.PI * s.radius) / 180;
  assert.ok(Math.abs(arc - 2 * Math.PI * 10) < 1e-9);
  // The base touches the middle of the arc.
  const [base] = net.circles;
  assert.ok(Math.abs(Math.hypot(...base.center) - (30 + 10)) < 1e-9);
  assert.equal(coneNet({ radius: 10, slant: 10 }).ok, false);
});

test('net scenes render without NaN, with and without lengths, fold lines dashed on request', () => {
  const nets = [boxNet({ width: 50, height: 40, depth: 30 }), cubeNet({ size: 40 }), cylinderNet({ radius: 10, height: 30 }), coneNet({ radius: 20, slant: 25 })];
  for (const net of nets) {
    for (const dims of [null, { show: true, unit: 'cm' }, { show: true, lengths: 'dimension' }]) {
      for (const fill of ['none', 'hatch', '#ddeeff']) {
        const scene = buildSceneNet(net, { fill }, { foldLines: 'dashed' }, dims);
        const svg = renderSvgString(scene);
        assert.ok(!/NaN|undefined/.test(svg), svg.slice(0, 200));
        if (dims) assert.ok(scene.items.some((it) => it.type === 'text'));
        else assert.ok(!scene.items.some((it) => it.type === 'text'));
      }
    }
  }
  const box = boxNet({ width: 50, height: 40, depth: 30 });
  const dashedCount = (o) => (renderSvgString(buildSceneNet(box, {}, o)).match(/stroke-dasharray/g) || []).length;
  assert.equal(dashedCount({ foldLines: 'dashed' }), 5);
  assert.equal(dashedCount({ foldLines: 'solid' }), 0);
});
