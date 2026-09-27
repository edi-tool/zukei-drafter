// UI wiring only: reads form state, validates it, calls the pure
// geometry/scene modules, and renders the resulting SVG. No geometry math here.
import {
  regularPolygon,
  triangleFromSSS,
  triangleFromSAS,
  triangleFromASA,
  generalPolygon,
  closingEdge,
  triangleMeasures,
} from './geometry2d.js';
import { renderSvgString } from './render-svg.js';
import { buildScene2D, buildScene3D } from './scene-builder.js';
import { downloadSvg, downloadPng, svgToPngBlob } from './export-png.js';
import { encodeState, decodeState } from './url-state.js';

const $ = (id) => document.getElementById(id);
const num = (id) => Number($(id).value);
// <input type=number> reports "" (-> 0 via Number) for empty or malformed text.
const escapeHtml = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const readNumber = (el) => (el.value.trim() === '' ? NaN : Number(el.value));

// Keeps both sides within what every modern browser's canvas supports.
const MAX_PNG_SIDE = 10000;

let mode = '2d';
let current = null; // { svg, width, height } of the last successful render
let defaults = {}; // form state at page load, so the URL only carries changes
let restoring = true; // suppress URL writes until the initial state is applied

// Form controls live in the settings panel and in the export bar under the preview.
const formRoots = () => [$('panel'), $('export-bar')];
const inForm = (el) => formRoots().some((root) => root.contains(el));

// Small line icons for the shape chips (24x24, stroke = currentColor).
const ICONS = {
  regular: '<polygon points="12,2.5 20.5,7.3 20.5,16.7 12,21.5 3.5,16.7 3.5,7.3" />',
  triangle: '<polygon points="12,3 21.5,20.5 2.5,20.5" />',
  general: '<polygon points="4,18 7,5 15,3 21,11 14,20" />',
  cube: '<path d="M4 8h11v11H4zM4 8l5-5h11v11l-5 5M15 8l5-5" />',
  box: '<path d="M2 10h14v9H2zM2 10l5-5h15v9l-6 5M16 10l6-5" />',
  triangularPrism: '<path d="M3 20l5-13 5 13zM8 7h11l5 13H13M19 7" transform="scale(.9) translate(-1 1)" />',
  quadrangularPrism: '<path d="M5 8h9v13H5zM5 8l4-4h9v13l-4 4M14 8l4-4" />',
  triangularPyramid: '<path d="M12 3L3 19l9 2 9-4zM12 3l0 18" />',
  quadrangularPyramid: '<path d="M12 3L3 16l6 4 12-2zM12 3l-3 17M12 3l9 15M3 16l4-3 14 5" />',
  cylinder: '<ellipse cx="12" cy="6" rx="7" ry="2.5" /><path d="M5 6v12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6" />',
  cone: '<path d="M12 3L5 18c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5z" />',
};

/** Replace a hidden <select> with a row of radio-like chips that drive it. */
function buildChips(container) {
  const select = $(container.dataset.for);
  container.setAttribute('role', 'radiogroup');
  for (const option of select.options) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.value = option.value;
    chip.setAttribute('role', 'radio');
    const icon = ICONS[option.value];
    chip.innerHTML = (icon ? `<svg viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` : '') + `<span>${option.textContent}</span>`;
    chip.addEventListener('click', () => {
      if (select.value === option.value) return;
      select.value = option.value;
      select.dispatchEvent(new Event('input', { bubbles: true }));
    });
    container.appendChild(chip);
  }
}

function syncChips() {
  for (const container of document.querySelectorAll('.chips')) {
    const value = $(container.dataset.for).value;
    for (const chip of container.children) {
      const on = chip.dataset.value === value;
      chip.setAttribute('aria-checked', String(on));
      chip.tabIndex = on ? 0 : -1;
    }
  }
}

// Arrow keys move between chips, as in a native radio group.
function onChipKeydown(event) {
  const chip = event.target.closest('.chip');
  if (!chip || !['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  const chips = [...chip.parentElement.children];
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1;
  const next = chips[(chips.indexOf(chip) + step + chips.length) % chips.length];
  next.click();
  next.focus();
}

const TRIANGLE_PRESETS = {
  equilateral: { 'sss-a': 50, 'sss-b': 50, 'sss-c': 50 },
  right345: { 'sss-a': 40, 'sss-b': 30, 'sss-c': 50 },
  isosceles: { 'sss-a': 40, 'sss-b': 60, 'sss-c': 60 },
};

function applyTrianglePreset(name) {
  $('triangle-method').value = 'sss';
  for (const [id, value] of Object.entries(TRIANGLE_PRESETS[name])) $(id).value = value;
  if (name === 'right345') $('ann-right-angles').value = 'auto';
  $('panel').dispatchEvent(new Event('input'));
}

// Highlight empty / out-of-range numbers. Native :invalid is not used because it
// also flags harmless step mismatches (e.g. 40 against min=0.01 step=0.1).
function markInvalidFields() {
  for (const el of document.querySelectorAll('#panel input[type="number"], #export-bar input[type="number"]')) {
    const v = el.validity;
    const bad = v.valueMissing || v.badInput || v.rangeUnderflow || v.rangeOverflow;
    if (bad) el.setAttribute('aria-invalid', 'true');
    else el.removeAttribute('aria-invalid');
  }
}

// ---------- sliders ----------

/** Pair every <input data-slider="min,max,step"> with a range slider. */
function buildSliders() {
  for (const input of document.querySelectorAll('input[data-slider]')) {
    const [min, max, step] = input.dataset.slider.split(',');
    const range = Object.assign(document.createElement('input'), { type: 'range', min, max, step, tabIndex: -1 });
    range.className = 'slider';
    range.setAttribute('aria-hidden', 'true');
    range.addEventListener('input', () => {
      input.value = range.value;
    });
    const pair = document.createElement('div');
    pair.className = 'slider-pair';
    input.before(pair);
    // The number comes first in the DOM so the surrounding <label> names it (a
    // label targets its first labelable descendant); CSS puts the slider on the left.
    pair.append(input, range);
  }
}

function syncSliders() {
  for (const range of document.querySelectorAll('.slider-pair .slider')) {
    const value = readNumber(range.previousElementSibling);
    if (Number.isFinite(value)) range.value = value;
  }
}

// ---------- steppers ----------

// Native number spinners are tiny (or missing) on touch screens, so every free
// number field without a slider gets large −/+ buttons. Holding a button repeats.
const STEPPER_SKIP = new Set(['png-custom-width']);

function nudge(input, direction) {
  const step = Number(input.dataset.nudge || (Number(input.step) >= 1 ? input.step : 1));
  const current = readNumber(input);
  let value = (Number.isFinite(current) ? current : 0) + direction * step;
  if (input.min !== '') value = Math.max(Number(input.min), value);
  if (input.max !== '') value = Math.min(Number(input.max), value);
  input.value = String(Number(value.toFixed(6)));
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function addStepper(input) {
  if (input.closest('.stepper, .slider-pair') || STEPPER_SKIP.has(input.id)) return;
  const wrap = document.createElement('div');
  wrap.className = 'stepper';
  const name = input.closest('.field')?.querySelector('span')?.textContent ?? '値';
  const button = (direction) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'stepper-btn';
    b.textContent = direction > 0 ? '+' : '−';
    b.title = `${name}を${direction > 0 ? '増やす' : '減らす'}`;
    // A pointer shortcut only, like the sliders: keyboard and screen-reader users
    // use the number field itself (arrow keys), and hiding the buttons keeps
    // them out of the field's accessible name.
    b.tabIndex = -1;
    b.setAttribute('aria-hidden', 'true');
    let timer = 0;
    const stop = () => clearTimeout(timer);
    const repeat = (delay) => {
      nudge(input, direction);
      timer = setTimeout(() => repeat(70), delay);
    };
    b.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || input.readOnly) return;
      event.preventDefault(); // keep focus (and the on-screen keyboard) where it was
      repeat(450);
    });
    for (const type of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(type, stop);
    b.addEventListener('contextmenu', (event) => event.preventDefault()); // long press = repeat, not a menu
    return b;
  };
  input.before(wrap);
  // Input first, as in buildSliders, so the <label> clicks focus it instead of pressing −.
  const minus = button(-1);
  minus.classList.add('stepper-minus');
  wrap.append(input, minus, button(1));
}

function buildSteppers(root = document) {
  for (const input of root.querySelectorAll('input[type="number"]:not([data-slider])')) {
    if (input.closest('#panel .field')) addStepper(input);
  }
}

// ---------- triangle helper ----------

// Schematic of which parts each construction method takes (given = accent).
const TRIANGLE_GIVEN = {
  sss: { sides: ['AB', 'CA', 'BC'], angles: [] },
  sas: { sides: ['AB', 'CA'], angles: ['A'] },
  asa: { sides: ['AB'], angles: ['A', 'B'] },
};

function renderTriangleDiagram() {
  const given = TRIANGLE_GIVEN[$('triangle-method').value];
  const P = { A: [30, 100], B: [190, 100], C: [80, 22] };
  const side = (name) => {
    const [p, q] = [P[name[0]], P[name[1]]];
    return `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" class="${given.sides.includes(name) ? 'given' : 'other'}" />`;
  };
  const arc = (v) => {
    const [cx, cy] = P[v];
    const [a, b] = v === 'A' ? [P.B, P.C] : [P.C, P.A];
    const at = (q) => {
      const d = Math.hypot(q[0] - cx, q[1] - cy);
      return [cx + ((q[0] - cx) * 18) / d, cy + ((q[1] - cy) * 18) / d].map((n) => n.toFixed(1));
    };
    const [p1, p2] = [at(a), at(b)];
    return `<path d="M${p1} A18 18 0 0 0 ${p2}" class="given" fill="none" />`;
  };
  const label = (v, dx, dy) => `<text x="${P[v][0] + dx}" y="${P[v][1] + dy}" class="${given.angles.includes(v) ? 'given-label' : ''}">${v}</text>`;
  $('triangle-diagram').innerHTML = `<svg viewBox="0 0 220 120">${['AB', 'BC', 'CA'].map(side).join('')}${given.angles.map(arc).join('')}${label('A', -14, 12)}${label('B', 6, 12)}${label('C', -4, -8)}</svg>`;
}

const fmt = (v) => String(Number(v.toFixed(2)));

function showTriangleMeasures(points) {
  if (!points) {
    $('triangle-measures').textContent = '';
    return;
  }
  const { sides, angles } = triangleMeasures(points);
  $('triangle-measures').textContent =
    `辺: AB = ${fmt(sides.AB)}, BC = ${fmt(sides.BC)}, CA = ${fmt(sides.CA)}　` +
    `角: A = ${fmt(angles.A)}°, B = ${fmt(angles.B)}°, C = ${fmt(angles.C)}°`;
}

// ---------- toast ----------

let toastTimer = 0;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.classList.toggle('is-error', isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2500);
}

// ---------- URL state ----------

function collectState() {
  const state = { mode };
  for (const el of formRoots().flatMap((root) => [...root.querySelectorAll('input[id], select[id]')])) {
    state[el.id] = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
  }
  document.querySelectorAll('.general-length').forEach((el, i) => (state[`gl${i}`] = el.value));
  document.querySelectorAll('.general-heading').forEach((el, i) => (state[`gh${i}`] = el.value));
  for (const el of document.querySelectorAll('.shape3d-field')) state[`d.${el.dataset.key}`] = el.value;
  return state;
}

function applyState(state) {
  const setValue = (el, value) => {
    if (el.type === 'checkbox') el.checked = value === '1';
    else el.value = value;
  };
  // Controls that rebuild other fields go first.
  for (const id of ['general-count', 'shape3d-type']) if (id in state) setValue($(id), state[id]);
  buildGeneralEdgeInputs();
  buildShape3DFields();
  for (const [key, value] of Object.entries(state)) {
    const el = document.getElementById(key);
    if (el && inForm(el) && el.matches('input, select')) setValue(el, value);
  }
  const lengths = document.querySelectorAll('.general-length');
  const headings = document.querySelectorAll('.general-heading');
  lengths.forEach((el, i) => {
    if (`gl${i}` in state) el.value = state[`gl${i}`];
    if (`gh${i}` in state) headings[i].value = state[`gh${i}`];
  });
  if (Object.keys(state).some((k) => /^g[lh]\d/.test(k))) $('general-edges').dataset.edited = 'true';
  for (const el of document.querySelectorAll('.shape3d-field')) {
    const key = `d.${el.dataset.key}`;
    if (key in state) el.value = state[key];
  }
  if (state.mode === '3d' || state.mode === '2d') mode = state.mode;
}

// Debounced: browsers throttle rapid history.replaceState calls (typing fires one render per key).
let urlTimer = 0;
function writeUrlState() {
  if (restoring) return;
  clearTimeout(urlTimer);
  urlTimer = setTimeout(writeUrlStateNow, 250);
}

function writeUrlStateNow() {
  const hash = encodeState(collectState(), defaults);
  const url = location.pathname + location.search + (hash ? `#${hash}` : '');
  if (url !== location.pathname + location.search + location.hash) history.replaceState(null, '', url);
}

/** ASCII file name (without extension); Chromium drops non-ASCII download names. */
function fileBaseName() {
  if (mode === '2d') {
    const type = $('shape2d-type').value;
    if (type === 'regular') return `regular-${$('regular-sides').value}gon`;
    if (type === 'triangle') return `triangle-${$('triangle-method').value}`;
    return `polygon-${document.querySelectorAll('.general-length').length}`;
  }
  return `${$('shape3d-type').value}_${$('projection-type').value}`;
}

/** A short Japanese label for the current figure (shown under the preview). */
function figureName() {
  if (mode === '2d') {
    const type = $('shape2d-type').value;
    if (type === 'regular') return `正${$('regular-sides').value}角形`;
    if (type === 'triangle') return '三角形';
    return `${document.querySelectorAll('.general-length').length}角形`;
  }
  const label = (id) => $(id).selectedOptions[0].textContent;
  return `${label('shape3d-type')}_${label('projection-type')}`;
}

function currentStyle() {
  const fillMode = $('style-fill-mode').value;
  const fill = fillMode === 'none' ? 'none' : fillMode === 'white' ? '#ffffff' : $('style-fill-color').value;
  const strokeWidth = readNumber($('style-stroke-width'));
  return {
    stroke: $('style-stroke').value,
    strokeWidth: strokeWidth > 0 ? strokeWidth : 2,
    fill,
  };
}

// ---------- 2D ----------

function buildGeneralEdgeInputs() {
  const count = Math.max(3, Math.min(20, Math.round(num('general-count')) || 3));
  const container = $('general-edges');
  // Once the user has edited an edge, keep those values for the edges that
  // survive a count change; untouched defaults are regenerated for the new count.
  const edited = container.dataset.edited === 'true';
  const kept = !edited ? [] : [...container.querySelectorAll('.edge-row')].slice(1).map((row) => ({
    length: row.querySelector('.general-length').value,
    heading: row.querySelector('.general-heading').value,
  }));
  if (container.children.length - 1 === count) return;
  container.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'edge-row';
  header.innerHTML = '<span></span><span>長さ</span><span>方向角(度)</span>';
  container.appendChild(header);
  for (let i = 0; i < count; i++) {
    // Defaults trace a regular polygon; 10 decimals keeps it within the closure tolerance.
    const heading = i < kept.length ? kept[i].heading : Number(((360 / count) * i).toFixed(10));
    const length = i < kept.length ? kept[i].length : '40';
    const row = document.createElement('div');
    row.className = 'edge-row';
    row.innerHTML = `
      <span>辺${i + 1}</span>
      <input type="number" required class="general-length" min="0.01" step="0.1" value="${escapeHtml(length)}" aria-label="辺${i + 1}の長さ" />
      <input type="number" required class="general-heading" step="any" value="${escapeHtml(heading)}" aria-label="辺${i + 1}の方向角" />
    `;
    container.appendChild(row);
  }
}

function formatError(value) {
  return value < 0.001 ? value.toExponential(2) : value.toFixed(3);
}

function compute2DShape() {
  const type = $('shape2d-type').value;
  for (const id of ['regular-error', 'triangle-error', 'general-error']) $(id).textContent = '';

  if (type === 'regular') {
    const sides = readNumber($('regular-sides'));
    const sideLength = readNumber($('regular-side-length'));
    const rotationDeg = readNumber($('regular-rotation'));
    if (!(Number.isInteger(sides) && sides >= 3 && sides <= 20)) {
      $('regular-error').textContent = '頂点数は3〜20の整数で入力してください。';
      return null;
    }
    if (!(sideLength > 0)) {
      $('regular-error').textContent = '一辺の長さは正の数で入力してください。';
      return null;
    }
    const { points } = regularPolygon({ sides, sideLength, rotationDeg: Number.isFinite(rotationDeg) ? rotationDeg : 0 });
    return { points, closed: true };
  }

  if (type === 'triangle') {
    const method = $('triangle-method').value;
    let result;
    if (method === 'sss') {
      result = triangleFromSSS({ a: readNumber($('sss-a')), b: readNumber($('sss-b')), c: readNumber($('sss-c')) });
    } else if (method === 'sas') {
      result = triangleFromSAS({ sideA: readNumber($('sas-a')), angleA: readNumber($('sas-angle')), sideB: readNumber($('sas-b')) });
    } else {
      result = triangleFromASA({ side: readNumber($('asa-side')), angleA: readNumber($('asa-angle-a')), angleB: readNumber($('asa-angle-b')) });
    }
    if (!result.ok) {
      $('triangle-error').textContent = result.reason;
      showTriangleMeasures(null);
      return null;
    }
    showTriangleMeasures(result.points);
    return { points: result.points, closed: true };
  }

  const lengthInputs = [...document.querySelectorAll('.general-length')];
  const headingInputs = [...document.querySelectorAll('.general-heading')];
  const autoClose = $('general-autoclose').checked;
  lengthInputs.at(-1).readOnly = headingInputs.at(-1).readOnly = autoClose;
  const lengths = lengthInputs.map(readNumber);
  const headingsDeg = headingInputs.map(readNumber);
  if (autoClose) {
    const last = closingEdge({ lengths: lengths.slice(0, -1), headingsDeg: headingsDeg.slice(0, -1) });
    if (!last.ok) {
      $('general-error').textContent = last.reason;
      return null;
    }
    lengths[lengths.length - 1] = last.length;
    headingsDeg[headingsDeg.length - 1] = last.headingDeg;
    lengthInputs.at(-1).value = Number(last.length.toFixed(6));
    headingInputs.at(-1).value = Number(last.headingDeg.toFixed(6));
  }
  const result = generalPolygon({ lengths, headingsDeg });
  if (!result.ok) {
    $('general-error').textContent = result.reason;
    return null;
  }
  if (!result.closed) {
    $('general-error').textContent = `閉じていません（閉合誤差 ${formatError(result.closureError)}）`;
  }
  return { points: result.points, closed: result.closed };
}

/** Annotation options for buildScene2D, or null when every annotation is off. */
function currentAnnotation() {
  const lengths = $('ann-lengths').checked ? $('ann-length-style').value : 'none';
  const vertexNames = $('ann-vertex-names').checked;
  const angles = $('ann-angles').checked;
  const rightAngles = $('ann-right-angles').value;
  if (!vertexNames && !angles && rightAngles !== 'auto' && lengths === 'none') return null;
  const decimals = readNumber($('ann-decimals'));
  const fontSize = readNumber($('ann-font-size'));
  return {
    vertexNames,
    angles,
    rightAngles,
    lengths,
    unit: $('ann-unit').value.trim(),
    decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 4 ? decimals : 1,
    fontSize: fontSize >= 6 && fontSize <= 72 ? fontSize : 18,
  };
}

/** Dimension options for buildScene3D, or null when the toggle is off. */
function currentDimensions3D() {
  if (!$('dim3d-show').checked) return null;
  const decimals = readNumber($('dim3d-decimals'));
  const fontSize = readNumber($('dim3d-font-size'));
  return {
    show: true,
    unit: $('dim3d-unit').value.trim(),
    decimals: Number.isInteger(decimals) && decimals >= 0 && decimals <= 4 ? decimals : 1,
    fontSize: fontSize >= 6 && fontSize <= 72 ? fontSize : 18,
  };
}

// ---------- 3D ----------

const SHAPE3D_FIELDS = {
  cube: [{ id: 'size', label: '一辺の長さ', value: 60 }],
  box: [
    { id: 'width', label: '幅', value: 80 },
    { id: 'height', label: '高さ', value: 50 },
    { id: 'depth', label: '奥行き', value: 40 },
  ],
  triangularPrism: [
    { id: 'sideLength', label: '底面の一辺', value: 50 },
    { id: 'height', label: '高さ', value: 70 },
  ],
  quadrangularPrism: [
    { id: 'width', label: '幅', value: 60 },
    { id: 'depth', label: '奥行き', value: 60 },
    { id: 'height', label: '高さ', value: 90 },
  ],
  triangularPyramid: [
    { id: 'sideLength', label: '底面の一辺', value: 60 },
    { id: 'height', label: '高さ', value: 70 },
  ],
  quadrangularPyramid: [
    { id: 'baseWidth', label: '底面の一辺', value: 60 },
    { id: 'height', label: '高さ', value: 70 },
  ],
  cylinder: [
    { id: 'radius', label: '半径', value: 30 },
    { id: 'height', label: '高さ', value: 70 },
  ],
  cone: [
    { id: 'radius', label: '半径', value: 35 },
    { id: 'height', label: '高さ', value: 70 },
  ],
};

function buildShape3DFields() {
  const container = $('shape3d-params');
  container.innerHTML = '';
  for (const field of SHAPE3D_FIELDS[$('shape3d-type').value]) {
    const label = document.createElement('label');
    label.className = 'field';
    label.innerHTML = `<span>${field.label}</span><input type="number" required class="shape3d-field" data-key="${field.id}" min="0.01" step="0.5" value="${field.value}" />`;
    container.appendChild(label);
  }
  buildSteppers(container);
}

function compute3DShape() {
  $('shape3d-error').textContent = '';
  $('oblique-error').textContent = '';
  const params = {};
  for (const input of document.querySelectorAll('.shape3d-field')) {
    params[input.dataset.key] = readNumber(input);
  }
  if (!Object.values(params).every((v) => v > 0)) {
    $('shape3d-error').textContent = '寸法はすべて正の数で入力してください。';
    return null;
  }
  const projection = $('projection-type').value;
  const options = {};
  if (projection === 'oblique') {
    const angleDeg = readNumber($('oblique-angle'));
    const scale = readNumber($('oblique-scale'));
    if (!Number.isFinite(angleDeg) || !(scale > 0 && scale <= 2)) {
      $('oblique-error').textContent = '角度は数値、奥行き倍率は0より大きく2以下で入力してください。';
      return null;
    }
    Object.assign(options, { angleDeg, scale });
  }
  return { shape: $('shape3d-type').value, params, projection, options };
}

// ---------- render ----------

function render() {
  const style = currentStyle();
  let scene = null;
  if (mode === '2d') {
    const shape = compute2DShape();
    if (shape) scene = buildScene2D(shape.points, shape.closed, style, currentAnnotation());
  } else {
    const input = compute3DShape();
    if (input) {
      scene = buildScene3D(
        input.shape,
        input.params,
        input.projection,
        input.options,
        { ...style, hiddenLineMode: $('hidden-line-mode').value },
        currentDimensions3D(),
      );
    }
  }
  current = scene ? { svg: renderSvgString(scene), width: scene.width, height: scene.height } : null;
  $('preview').innerHTML = current
    ? current.svg
    : '<p class="preview-empty">図形を描けません。左側の赤いメッセージの項目を確認してください。</p>';
  $('preview-caption').textContent = current ? `${figureName()}（${current.width} × ${current.height} px 基準）` : '';
  markInvalidFields();
  updateExportInfo();
  writeUrlState();
}

function pngSize() {
  if (!current) return null;
  const choice = $('png-resolution').value;
  const width =
    choice === 'custom'
      ? Math.round(readNumber($('png-custom-width')))
      : current.width * Number(choice);
  const height = Math.round((width * current.height) / current.width);
  const inRange = (v) => v >= 16 && v <= MAX_PNG_SIDE;
  return inRange(width) && inRange(height) ? { width, height } : null;
}

function updateExportInfo() {
  $('png-custom-width-field').hidden = $('png-resolution').value !== 'custom';
  const size = pngSize();
  $('btn-save-svg').disabled = !current;
  $('btn-copy-png').disabled = !size;
  $('btn-save-png').disabled = !size;
  if (!current) {
    $('png-size-info').textContent = '図形が生成されていないため保存できません。';
  } else if (!size) {
    $('png-size-info').textContent = `出力サイズは縦横とも16〜${MAX_PNG_SIDE}pxの範囲になるよう指定してください。`;
  } else {
    $('png-size-info').textContent = `出力サイズ: ${size.width} × ${size.height} px`;
  }
}

// ---------- wiring ----------

function setMode(newMode) {
  mode = newMode;
  $('panel-2d').hidden = mode !== '2d';
  $('panel-3d').hidden = mode !== '3d';
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
  });
  syncChips();
  render();
}

function syncVisibility() {
  const type2d = $('shape2d-type').value;
  $('fieldset-regular').hidden = type2d !== 'regular';
  $('fieldset-triangle').hidden = type2d !== 'triangle';
  $('fieldset-general').hidden = type2d !== 'general';
  const method = $('triangle-method').value;
  $('triangle-sss').hidden = method !== 'sss';
  $('triangle-sas').hidden = method !== 'sas';
  $('triangle-asa').hidden = method !== 'asa';
  $('oblique-params').hidden = $('projection-type').value !== 'oblique';
  const anyAnnotation =
    ['ann-vertex-names', 'ann-lengths', 'ann-angles'].some((id) => $(id).checked) || $('ann-right-angles').value === 'auto';
  $('ann-options').hidden = !anyAnnotation;
  $('ann-length-style-field').hidden = !$('ann-lengths').checked;
  $('ann-unit-field').hidden = !$('ann-lengths').checked;
  $('dim3d-options').hidden = !$('dim3d-show').checked;
  $('style-fill-color').hidden = $('style-fill-mode').value !== 'custom';
  syncChips();
  syncSliders();
  renderTriangleDiagram();
}

function wireEvents() {
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // Rebuild dynamic field lists before the generic handler below re-renders.
  $('general-count').addEventListener('input', buildGeneralEdgeInputs);
  $('general-edges').addEventListener('input', () => {
    $('general-edges').dataset.edited = 'true';
  });
  $('shape3d-type').addEventListener('input', buildShape3DFields);

  // One delegated handler: any form change re-syncs visibility and re-renders.
  for (const root of formRoots()) {
    root.addEventListener('input', () => {
      syncVisibility();
      render();
    });
    root.addEventListener('keydown', onChipKeydown);
  }

  document.querySelectorAll('.chips').forEach(buildChips);

  // Phones: jump past the settings to the save buttons (a #fragment link would clobber the URL state).
  $('btn-jump-save').addEventListener('click', () => $('export-bar').scrollIntoView({ behavior: 'smooth' }));

  // Ctrl/Cmd+S saves the PNG instead of the page.
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!$('btn-save-png').disabled) $('btn-save-png').click();
    }
  });
  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => applyTrianglePreset(btn.dataset.preset));
  });

  $('btn-copy-png').addEventListener('click', async () => {
    const size = pngSize();
    if (!current || !size) return;
    try {
      // Pass the Blob promise directly so Safari keeps the user-gesture context.
      const blob = svgToPngBlob(current.svg, {
        outputWidth: size.width,
        outputHeight: size.height,
        background: $('png-background').value,
      });
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast(`PNG（${size.width} × ${size.height} px）をコピーしました`);
    } catch (err) {
      console.info(err);
      toast('このブラウザではクリップボードへのコピーができません。「PNGを保存」を使ってください。', true);
    }
  });

  $('btn-copy-link').addEventListener('click', async () => {
    clearTimeout(urlTimer);
    writeUrlStateNow();
    try {
      await navigator.clipboard.writeText(location.href);
      toast('この図のリンクをコピーしました');
    } catch {
      toast('リンクをコピーできませんでした。アドレスバーのURLをそのまま使えます。', true);
    }
  });

  $('btn-reset').addEventListener('click', () => {
    if (!confirm('すべての入力を初期値に戻しますか？')) return;
    delete $('general-edges').dataset.edited;
    clearTimeout(urlTimer);
    restoring = true;
    applyState(defaults);
    restoring = false;
    setMode(mode);
    syncVisibility();
    render();
    toast('初期値に戻しました');
  });

  $('btn-save-svg').addEventListener('click', () => {
    if (current) downloadSvg(current.svg, `${fileBaseName()}.svg`);
  });

  $('btn-save-png').addEventListener('click', async () => {
    const size = pngSize();
    if (!current || !size) return;
    const button = $('btn-save-png');
    button.disabled = true;
    try {
      await downloadPng(
        current.svg,
        { outputWidth: size.width, outputHeight: size.height, background: $('png-background').value },
        `${fileBaseName()}.png`,
      );
    } catch (err) {
      console.error(err);
      alert('PNGの生成に失敗しました: ' + err.message);
    } finally {
      updateExportInfo();
    }
  });
}

buildGeneralEdgeInputs();
buildShape3DFields();
buildSliders();
buildSteppers();
wireEvents();
defaults = collectState();
const initial = decodeState(location.hash);
if (Object.keys(initial).length) applyState(initial);
restoring = false;
syncVisibility();
setMode(mode);
