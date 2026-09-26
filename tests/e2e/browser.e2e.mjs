// Browser end-to-end check (development only; the app itself never needs it).
//   npm install && npm run test:e2e
// Serves the repo with a tiny static server, drives the UI with Playwright and
// verifies rendering, validation, PNG/SVG export and a clean console.
// Set CHROMIUM_PATH to use an already-installed Chromium instead of
// `npx playwright install chromium`.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const file = (await stat(path)).isDirectory() ? join(path, 'index.html') : path;
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}/`;

// Fall back to the cloud sessions' preinstalled Chromium when Playwright's own
// bundled build is missing (its version often differs from the preinstalled one).
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (existsSync(chromium.executablePath())) return undefined;
  return existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined;
}
const browser = await chromium.launch({ executablePath: chromiumPath() });
const page = await browser.newPage({ acceptDownloads: true });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (msg) => {
  if (msg.type() === 'error' || msg.type() === 'warning') errors.push(`console.${msg.type()}: ${msg.text()}`);
});

let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`ok - ${name}`);
}

async function set(selector, value) {
  await page.fill(selector, String(value));
}
// Shape / method / projection pickers are chip buttons driving a hidden <select>.
async function choose(selectId, value) {
  await page.click(`.chips[data-for="${selectId}"] .chip[data-value="${value}"]`);
  assert.equal(await page.inputValue(`#${selectId}`), value);
}
const preview = () => page.locator('#preview').innerHTML();
const count = async (tag) => ((await preview()).match(new RegExp(`<${tag}[ >]`, 'g')) || []).length;
const dashed = async () => ((await preview()).match(/stroke-dasharray/g) || []).length;

function pngInfo(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'PNG signature');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

try {
  await page.goto(baseUrl);
  await page.waitForSelector('#preview svg');

  await check('2D regular polygon renders by default', async () => {
    assert.equal(await count('polygon'), 1);
  });

  await check('annotations are off by default (no text, options hidden)', async () => {
    assert.equal(await count('text'), 0);
    assert.equal(await page.locator('#ann-options').isVisible(), false);
    for (const id of ['#ann-vertex-names', '#ann-lengths', '#ann-angles']) assert.equal(await page.isChecked(id), false);
  });

  await check('only the selected shape\'s inputs are visible (hidden attribute is honored)', async () => {
    const visible = async () => ({
      regular: await page.locator('#fieldset-regular').isVisible(),
      triangle: await page.locator('#fieldset-triangle').isVisible(),
      general: await page.locator('#fieldset-general').isVisible(),
    });
    assert.deepEqual(await visible(), { regular: true, triangle: false, general: false });
    await choose('shape2d-type', 'general');
    assert.deepEqual(await visible(), { regular: false, triangle: false, general: true });
    assert.equal(await page.locator('#png-custom-width-field').isVisible(), false);
    await choose('shape2d-type', 'regular');
  });

  await check('2D SSS triangle: valid, then impossible, then empty input', async () => {
    await choose('shape2d-type', 'triangle');
    await set('#sss-a', 3);
    await set('#sss-b', 4);
    await set('#sss-c', 5);
    assert.equal(await count('polygon'), 1);
    assert.equal(await page.locator('#triangle-error').innerText(), '');
    await set('#sss-c', 10);
    assert.match(await page.locator('#triangle-error').innerText(), /成立条件/);
    assert.equal(await count('svg'), 0);
    assert.ok(await page.locator('#btn-save-png').isDisabled());
    await set('#sss-c', '');
    assert.match(await page.locator('#triangle-error').innerText(), /正の数/);
  });

  await check('2D general polygon: defaults close for 7 edges, editing opens it', async () => {
    await choose('shape2d-type', 'general');
    await set('#general-count', 7);
    assert.equal(await page.locator('#general-error').innerText(), '');
    assert.equal(await count('polygon'), 1);
    await page.locator('.general-length').first().fill('55');
    assert.match(await page.locator('#general-error').innerText(), /閉じていません（閉合誤差 15\.000）/);
    assert.equal(await count('polyline'), 1);
    // Changing the edge count keeps what was typed for the surviving edges.
    await set('#general-count', 8);
    assert.equal(await page.locator('.general-length').count(), 8);
    assert.equal(await page.locator('.general-length').first().inputValue(), '55');
    await set('#general-count', 7);
    assert.equal(await page.locator('.general-length').first().inputValue(), '55');
  });

  await check('annotations: vertex names, lengths (label / dimension line), angles, then off again', async () => {
    await choose('shape2d-type', 'triangle');
    await choose('triangle-method', 'sss');
    await set('#sss-a', 3);
    await set('#sss-b', 4);
    await set('#sss-c', 5);
    const plain = await preview();
    const textsNow = () => page.$$eval('#preview svg text', (els) => els.map((e) => e.textContent).sort());

    await page.check('#ann-vertex-names');
    assert.deepEqual(await textsNow(), ['A', 'B', 'C']);
    assert.equal(await page.locator('#ann-options').isVisible(), true);
    assert.equal(await page.locator('#ann-unit').isVisible(), false, 'unit only applies to lengths');

    await page.check('#ann-lengths');
    await set('#ann-unit', 'cm');
    assert.deepEqual(await textsNow(), ['3cm', '4cm', '5cm', 'A', 'B', 'C']);
    await page.selectOption('#ann-length-style', 'dimension');
    assert.equal(await count('line'), 9, '2 extension lines + 1 dimension line per edge');
    assert.equal(await count('polygon'), 1 + 6, 'figure + 2 arrowheads per edge');

    await page.check('#ann-angles');
    await set('#ann-decimals', 0);
    assert.deepEqual(await textsNow(), ['37°', '3cm', '4cm', '53°', '5cm', '90°', 'A', 'B', 'C']);
    assert.ok(!(await preview()).includes('NaN'));

    await page.uncheck('#ann-vertex-names');
    await page.uncheck('#ann-lengths');
    await page.uncheck('#ann-angles');
    assert.equal(await preview(), plain, 'all off gives the plain figure again');
    assert.equal(await page.locator('#ann-options').isVisible(), false);
  });

  await check('right-angle mark: "auto" detects the 90° corner of a 3-4-5 triangle and suppresses its angle label', async () => {
    const textsNow = () => page.$$eval('#preview svg text', (els) => els.map((e) => e.textContent).sort());

    // Right-angle marks work even with the angle arcs/labels turned off.
    assert.equal(await page.locator('#ann-options').isVisible(), false);
    await page.selectOption('#ann-right-angles', 'auto');
    assert.equal(await page.locator('#ann-options').isVisible(), true, 'font-size etc. become relevant once a mark can be drawn');
    assert.equal(await count('text'), 0, 'no angle labels are drawn just for the mark');
    const linesWithMarkOnly = await count('line');
    assert.ok(linesWithMarkOnly > 0, 'the mark itself is drawn as line segments');

    await page.check('#ann-angles');
    await set('#ann-decimals', 0);
    assert.deepEqual(await textsNow(), ['37°', '53°'], '90° label is replaced by the right-angle mark, not duplicated');
    assert.equal(await count('line'), linesWithMarkOnly, 'same mark, now alongside the other two angle arcs');

    await page.selectOption('#ann-right-angles', 'hidden');
    assert.deepEqual(await textsNow(), ['37°', '53°', '90°'], 'back to a normal arc + label once "hidden" is selected');

    await page.uncheck('#ann-angles');
    await page.selectOption('#ann-right-angles', 'hidden');
    assert.equal(await count('text'), 0);
    assert.equal(await page.locator('#ann-options').isVisible(), false);
  });

  await check('annotations: text in the PNG matches the browser\'s own glyphs and stays inside the image', async () => {
    await choose('shape2d-type', 'regular');
    await page.check('#ann-vertex-names');
    await page.check('#ann-lengths');
    await page.check('#ann-angles');
    await set('#ann-decimals', 1);
    await set('#ann-unit', 'cm');
    await page.selectOption('#ann-length-style', 'label');
    const result = await page.evaluate(async () => {
      const { svgToPngBlob } = await import('./js/export-png.js');
      const { estimateTextBox } = await import('./js/annotations.js');
      const svgEl = document.querySelector('#preview svg');
      const w = Number(svgEl.getAttribute('width'));
      const h = Number(svgEl.getAttribute('height'));
      const texts = [...svgEl.querySelectorAll('text')];
      const boxes = texts.map((t) => {
        const b = t.getBBox();
        return { x: b.x, y: b.y, width: b.width, height: b.height, estimate: estimateTextBox(t.textContent, Number(t.getAttribute('font-size'))).width };
      });

      const k = 3; // rasterize at 3x
      const pixels = async (svg, drawExtra) => {
        const bitmap = await createImageBitmap(await svgToPngBlob(svg, { outputWidth: w * k, outputHeight: h * k, background: 'white' }));
        const canvas = new OffscreenCanvas(w * k, h * k);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        if (drawExtra) drawExtra(ctx);
        return ctx.getImageData(0, 0, w * k, h * k).data; // throws if the canvas were tainted
      };
      const withText = await pixels(svgEl.outerHTML);
      const bare = svgEl.cloneNode(true);
      bare.querySelectorAll('text').forEach((t) => t.remove());
      const reference = await pixels(bare.outerHTML, (ctx) => {
        for (const t of texts) {
          ctx.font = `${Number(t.getAttribute('font-size')) * k}px ${t.getAttribute('font-family')}`;
          ctx.textAlign = 'center';
          ctx.fillStyle = t.getAttribute('fill');
          ctx.fillText(t.textContent, Number(t.getAttribute('x')) * k, Number(t.getAttribute('y')) * k);
        }
      });
      const withoutText = await pixels(bare.outerHTML);

      // Compare dark-pixel masks inside the text boxes only.
      let both = 0;
      let either = 0;
      let inkPng = 0;
      let inkBare = 0;
      const dark = (data, i) => data[i] < 128;
      for (const b of boxes) {
        for (let y = Math.floor(b.y * k); y < Math.ceil((b.y + b.height) * k); y++) {
          for (let x = Math.floor(b.x * k); x < Math.ceil((b.x + b.width) * k); x++) {
            const i = (y * w * k + x) * 4;
            const a = dark(withText, i);
            const r = dark(reference, i);
            if (a && r) both++;
            if (a || r) either++;
            if (a) inkPng++;
            if (dark(withoutText, i)) inkBare++;
          }
        }
      }
      return { w, h, boxes, iou: both / either, inkPng, inkBare, count: texts.length };
    });
    assert.equal(result.count, 6 + 6 + 6, 'hexagon: 6 names, 6 lengths, 6 angles');
    for (const b of result.boxes) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.width <= result.w && b.y + b.height <= result.h, `text box inside image: ${JSON.stringify(b)}`);
      assert.ok(b.width <= b.estimate * 1.1, `layout estimate covers the real width: ${JSON.stringify(b)}`);
    }
    assert.ok(result.inkPng > 5 * Math.max(1, result.inkBare), `text is drawn into the PNG (ink ${result.inkPng} vs ${result.inkBare} without text)`);
    assert.ok(result.iou > 0.8, `PNG glyphs match canvas fillText with the same font (IoU ${result.iou.toFixed(3)})`);

    for (const id of ['#ann-vertex-names', '#ann-lengths', '#ann-angles']) await page.uncheck(id);
    assert.equal(await count('text'), 0);
  });

  await page.click('.mode-btn[data-mode="3d"]');

  const projections = ['isometric', 'cavalier', 'cabinet', 'oblique'];
  for (const projection of projections) {
    await check(`3D cube (${projection}): 12 edges, 3 dashed`, async () => {
      await choose('shape3d-type', 'cube');
      await choose('projection-type', projection);
      await page.selectOption('#hidden-line-mode', 'dashed');
      assert.equal(await count('line'), 12);
      assert.equal(await dashed(), 3);
    });
  }

  await check('3D every shape renders under every projection without errors', async () => {
    const shapes = await page.$$eval('#shape3d-type option', (opts) => opts.map((o) => o.value));
    for (const shape of shapes) {
      await choose('shape3d-type', shape);
      for (const projection of projections) {
        await choose('projection-type', projection);
        assert.ok((await preview()).includes('<svg'), `${shape}/${projection}`);
        assert.ok(!(await preview()).includes('NaN'), `${shape}/${projection} has NaN`);
      }
    }
  });

  await check('3D cylinder: hidden back arc is dashed or omitted per setting', async () => {
    await choose('shape3d-type', 'cylinder');
    await choose('projection-type', 'cabinet');
    await page.selectOption('#hidden-line-mode', 'dashed');
    assert.equal(await count('path'), 3);
    assert.equal(await dashed(), 1);
    await page.selectOption('#hidden-line-mode', 'hidden');
    assert.equal(await count('path'), 2);
    assert.equal(await dashed(), 0);
  });

  await check('3D invalid dimensions and oblique scale are reported, nothing is drawn', async () => {
    await page.locator('.shape3d-field').first().fill('');
    assert.match(await page.locator('#shape3d-error').innerText(), /正の数/);
    assert.equal(await count('svg'), 0);
    await page.locator('.shape3d-field').first().fill('30');
    await choose('projection-type', 'oblique');
    await set('#oblique-scale', 0);
    assert.match(await page.locator('#oblique-error').innerText(), /奥行き倍率/);
    await set('#oblique-scale', 0.5);
    assert.equal(await count('svg'), 1);
  });

  await check('PNG download: 4x preset gives > 2000px with the reported size', async () => {
    await choose('shape3d-type', 'box');
    await page.selectOption('#png-resolution', '4');
    const info = await page.locator('#png-size-info').innerText();
    const [, w, h] = info.match(/(\d+) × (\d+)/).map(Number);
    assert.ok(w > 2000);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save-png')]);
    assert.equal(download.suggestedFilename(), 'box_oblique.png');
    const size = pngInfo(await readFile(await download.path()));
    assert.deepEqual(size, { width: w, height: h });
  });

  await check('PNG custom width keeps the figure aspect ratio', async () => {
    await page.selectOption('#png-resolution', 'custom');
    await set('#png-custom-width', 2500);
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save-png')]);
    const { width, height } = pngInfo(await readFile(await download.path()));
    const svgSize = await page.$eval('#preview svg', (s) => [Number(s.getAttribute('width')), Number(s.getAttribute('height'))]);
    assert.equal(width, 2500);
    assert.ok(Math.abs(height - (2500 * svgSize[1]) / svgSize[0]) <= 1);
  });

  await check('PNG background: transparent corners vs white corners, dark crisp strokes', async () => {
    const result = await page.evaluate(async () => {
      const { svgToPngBlob } = await import('./js/export-png.js');
      const svg = document.querySelector('#preview svg').outerHTML;
      const w = 3000;
      const h = Math.round((w * document.querySelector('#preview svg').getAttribute('height')) / document.querySelector('#preview svg').getAttribute('width'));
      const out = {};
      for (const background of ['transparent', 'white']) {
        const bitmap = await createImageBitmap(await svgToPngBlob(svg, { outputWidth: w, outputHeight: h, background }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(bitmap, 0, 0);
        const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height).data;
        let dark = 0;
        for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 200 && data[i] < 60) dark++;
        out[background] = { corner: [...ctx.getImageData(0, 0, 1, 1).data], dark };
      }
      return out;
    });
    assert.equal(result.transparent.corner[3], 0, 'transparent background');
    assert.deepEqual(result.white.corner, [255, 255, 255, 255], 'white background');
    // Strokes scale with the output (2px at 800 => ~7.5px at 3000), so many solid dark pixels exist.
    assert.ok(result.transparent.dark > 20000, `dark pixels: ${result.transparent.dark}`);
  });

  await check('SVG download', async () => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-save-svg')]);
    assert.equal(download.suggestedFilename(), 'box_oblique.svg');
    assert.match(await readFile(await download.path(), 'utf8'), /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });

  await check('UI: triangle presets, invalid-field highlight and empty-preview message', async () => {
    await page.click('.mode-btn[data-mode="2d"]');
    await choose('shape2d-type', 'triangle');
    await page.click('.preset-btn[data-preset="right345"]');
    assert.equal(await page.inputValue('#triangle-method'), 'sss');
    assert.equal(await page.getAttribute('.chips[data-for="triangle-method"] .chip[data-value="sss"]', 'aria-checked'), 'true');
    assert.equal(await page.inputValue('#ann-right-angles'), 'auto');
    assert.equal(await count('polygon'), 1);
    await set('#sss-a', '');
    assert.equal(await page.getAttribute('#sss-a', 'aria-invalid'), 'true');
    assert.equal(await page.getAttribute('#sss-b', 'aria-invalid'), null, 'valid values are not flagged');
    assert.match(await page.locator('.preview-empty').innerText(), /赤いメッセージ/);
    await set('#sss-a', 40);
    assert.equal(await count('polygon'), 1);
  });

  await check('UI: settings live in the URL hash and are restored on reload; reset clears them', async () => {
    await choose('shape2d-type', 'regular');
    await set('#regular-sides', 5);
    await page.waitForURL(/regular-sides=5/);
    await page.reload();
    await page.waitForSelector('#preview svg');
    assert.equal(await page.inputValue('#regular-sides'), '5');
    assert.equal(await page.getAttribute('.chips[data-for="shape2d-type"] .chip[data-value="regular"]', 'aria-checked'), 'true');
    assert.match(await page.locator('#preview-caption').innerText(), /正5角形/);
    page.once('dialog', (d) => d.accept());
    await page.click('#btn-reset');
    assert.equal(await page.inputValue('#regular-sides'), '6');
    assert.equal(await page.inputValue('#ann-right-angles'), 'hidden');
    await page.waitForTimeout(400);
    assert.equal(new URL(page.url()).hash, '');
  });

  await check('UI: 3D state (mode, shape, dimensions) round-trips through the URL', async () => {
    await page.click('.mode-btn[data-mode="3d"]');
    await choose('shape3d-type', 'cylinder');
    await set('.shape3d-field[data-key="radius"]', 12);
    await page.waitForURL(/d\.radius=12/);
    await page.reload();
    await page.waitForSelector('#preview svg');
    assert.equal(await page.locator('#panel-3d').isVisible(), true);
    assert.equal(await page.inputValue('#shape3d-type'), 'cylinder');
    assert.equal(await page.inputValue('.shape3d-field[data-key="radius"]'), '12');
    page.once('dialog', (d) => d.accept());
    await page.click('#btn-reset');
    assert.equal(await page.locator('#panel-2d').isVisible(), true);
  });

  await check('UI: copy PNG to the clipboard', async () => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl });
    await page.click('#btn-copy-png');
    await page.waitForFunction(() => /PNG.*コピーしました/.test(document.querySelector('#toast').textContent));
    const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((item) => item.types));
    assert.ok(types.includes('image/png'), `clipboard types: ${types}`);
  });

  await check('no console errors or warnings during the whole session', async () => {
    assert.deepEqual(errors, []);
  });

  console.log(`\n${passed} browser checks passed`);
} finally {
  await browser.close();
  server.close();
}
