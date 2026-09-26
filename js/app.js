// UI wiring only: reads form state, validates it, calls the pure
// geometry/scene modules, and renders the resulting SVG. No geometry math here.
import { regularPolygon, triangleFromSSS, triangleFromSAS, triangleFromASA, generalPolygon } from './geometry2d.js';
import { renderSvgString } from './render-svg.js';
import { buildScene2D, buildScene3D } from './scene-builder.js';
import { downloadSvg, downloadPng } from './export-png.js';

const $ = (id) => document.getElementById(id);
const num = (id) => Number($(id).value);
// <input type=number> reports "" (-> 0 via Number) for empty or malformed text.
const readNumber = (el) => (el.value.trim() === '' ? NaN : Number(el.value));

// Keeps both sides within what every modern browser's canvas supports.
const MAX_PNG_SIDE = 10000;

let mode = '2d';
let current = null; // { svg, width, height } of the last successful render

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
  container.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'edge-row';
  header.innerHTML = '<span></span><span>長さ</span><span>方向角(度)</span>';
  container.appendChild(header);
  for (let i = 0; i < count; i++) {
    // Defaults trace a regular polygon; 10 decimals keeps it within the closure tolerance.
    const heading = Number(((360 / count) * i).toFixed(10));
    const row = document.createElement('div');
    row.className = 'edge-row';
    row.innerHTML = `
      <span>辺${i + 1}</span>
      <input type="number" class="general-length" min="0.01" step="0.1" value="40" aria-label="辺${i + 1}の長さ" />
      <input type="number" class="general-heading" step="any" value="${heading}" aria-label="辺${i + 1}の方向角" />
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
      return null;
    }
    return { points: result.points, closed: true };
  }

  const lengths = [...document.querySelectorAll('.general-length')].map(readNumber);
  const headingsDeg = [...document.querySelectorAll('.general-heading')].map(readNumber);
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
  if (!vertexNames && !angles && lengths === 'none') return null;
  const decimals = readNumber($('ann-decimals'));
  const fontSize = readNumber($('ann-font-size'));
  return {
    vertexNames,
    angles,
    lengths,
    unit: $('ann-unit').value.trim(),
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
    label.innerHTML = `<span>${field.label}</span><input type="number" class="shape3d-field" data-key="${field.id}" min="0.01" step="0.5" value="${field.value}" />`;
    container.appendChild(label);
  }
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
      scene = buildScene3D(input.shape, input.params, input.projection, input.options, {
        ...style,
        hiddenLineMode: $('hidden-line-mode').value,
      });
    }
  }
  current = scene ? { svg: renderSvgString(scene), width: scene.width, height: scene.height } : null;
  $('preview').innerHTML = current ? current.svg : '';
  updateExportInfo();
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
  const anyAnnotation = ['ann-vertex-names', 'ann-lengths', 'ann-angles'].some((id) => $(id).checked);
  $('ann-options').hidden = !anyAnnotation;
  $('ann-length-style-field').hidden = !$('ann-lengths').checked;
  $('ann-unit-field').hidden = !$('ann-lengths').checked;
  $('style-fill-color').hidden = $('style-fill-mode').value !== 'custom';
}

function wireEvents() {
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // Rebuild dynamic field lists before the generic handler below re-renders.
  $('general-count').addEventListener('input', buildGeneralEdgeInputs);
  $('shape3d-type').addEventListener('input', buildShape3DFields);

  // One delegated handler: any form change re-syncs visibility and re-renders.
  $('panel').addEventListener('input', () => {
    syncVisibility();
    render();
  });

  $('btn-save-svg').addEventListener('click', () => {
    if (current) downloadSvg(current.svg, 'shape.svg');
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
        'shape.png',
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
syncVisibility();
wireEvents();
render();
