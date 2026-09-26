// UI wiring only: reads form state, calls the pure geometry/scene modules,
// and renders the resulting SVG. No geometry math lives in this file.
import { regularPolygon, triangleFromSSS, triangleFromSAS, triangleFromASA, generalPolygon } from './geometry2d.js';
import { renderSvgString } from './render-svg.js';
import { buildScene2D, buildScene3D } from './scene-builder.js';
import { downloadSvg, downloadPng } from './export-png.js';

const $ = (id) => document.getElementById(id);

let mode = '2d';
let currentSvgString = '';
let previewWidth = 640;
let previewHeight = 640;

function currentStyle() {
  const fillMode = $('style-fill-mode').value;
  const fill = fillMode === 'none' ? 'none' : fillMode === 'white' ? '#ffffff' : $('style-fill-color').value;
  return {
    stroke: $('style-stroke').value,
    strokeWidth: Number($('style-stroke-width').value) || 2,
    fill,
    width: previewWidth,
    height: previewHeight,
    background: 'none',
  };
}

// ---------- 2D ----------

function buildGeneralEdgeInputs() {
  const count = Math.max(3, Math.min(20, Number($('general-count').value) || 3));
  const container = $('general-edges');
  container.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'edge-row';
  header.innerHTML = '<span></span><span>長さ</span><span>方向角(度)</span>';
  container.appendChild(header);
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'edge-row';
    const defaultHeading = Math.round((360 / count) * i);
    row.innerHTML = `
      <span>辺${i + 1}</span>
      <input type="number" class="general-length" min="0.01" step="0.1" value="40" />
      <input type="number" class="general-heading" step="1" value="${defaultHeading}" />
    `;
    container.appendChild(row);
  }
}

function compute2DShape() {
  const type = $('shape2d-type').value;
  $('triangle-error').textContent = '';
  $('general-error').textContent = '';

  if (type === 'regular') {
    const sides = Math.round(Number($('regular-sides').value));
    const sideLength = Number($('regular-side-length').value);
    const rotationDeg = Number($('regular-rotation').value) || 0;
    if (!(sides >= 3 && sides <= 20) || !(sideLength > 0)) return null;
    const { points } = regularPolygon({ sides, sideLength, rotationDeg });
    return { points, closed: true };
  }

  if (type === 'triangle') {
    const method = $('triangle-method').value;
    let result;
    if (method === 'sss') {
      result = triangleFromSSS({
        a: Number($('sss-a').value),
        b: Number($('sss-b').value),
        c: Number($('sss-c').value),
      });
    } else if (method === 'sas') {
      result = triangleFromSAS({
        sideA: Number($('sas-a').value),
        angleC: Number($('sas-angle').value),
        sideB: Number($('sas-b').value),
      });
    } else {
      result = triangleFromASA({
        side: Number($('asa-side').value),
        angleA: Number($('asa-angle-a').value),
        angleB: Number($('asa-angle-b').value),
      });
    }
    if (!result.ok) {
      $('triangle-error').textContent = result.reason;
      return null;
    }
    return { points: result.points, closed: true };
  }

  if (type === 'general') {
    const lengthInputs = [...document.querySelectorAll('.general-length')];
    const headingInputs = [...document.querySelectorAll('.general-heading')];
    const lengths = lengthInputs.map((el) => Number(el.value));
    const headingsDeg = headingInputs.map((el) => Number(el.value));
    if (lengths.some((v) => !(v > 0))) {
      $('general-error').textContent = '辺の長さはすべて正の数で入力してください。';
      return null;
    }
    const result = generalPolygon({ lengths, headingsDeg });
    if (!result.closed) {
      $('general-error').textContent = `閉じていません（閉合誤差 ${result.closureError.toFixed(3)}）`;
    }
    return { points: result.points, closed: result.closed };
  }
  return null;
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
    { id: 'height', label: '高さ(柱の長さ)', value: 70 },
  ],
  quadrangularPrism: [
    { id: 'width', label: '幅', value: 80 },
    { id: 'depth', label: '奥行き', value: 50 },
    { id: 'height', label: '高さ', value: 60 },
  ],
  triangularPyramid: [
    { id: 'sideLength', label: '底面の一辺', value: 60 },
    { id: 'height', label: '高さ', value: 70 },
  ],
  quadrangularPyramid: [
    { id: 'baseWidth', label: '底辺の一辺', value: 60 },
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
  const type = $('shape3d-type').value;
  const container = $('shape3d-params');
  container.innerHTML = '';
  for (const field of SHAPE3D_FIELDS[type]) {
    const label = document.createElement('label');
    label.className = 'field';
    label.innerHTML = `<span>${field.label}</span><input type="number" class="shape3d-field" data-key="${field.id}" min="0.01" step="0.5" value="${field.value}" />`;
    container.appendChild(label);
  }
}

function compute3DShapeParams() {
  const params = {};
  for (const input of document.querySelectorAll('.shape3d-field')) {
    params[input.dataset.key] = Number(input.value);
  }
  return params;
}

// ---------- render loop ----------

function render() {
  const style = currentStyle();
  let scene;
  if (mode === '2d') {
    const shape = compute2DShape();
    if (!shape) {
      $('preview').innerHTML = '';
      currentSvgString = '';
      return;
    }
    scene = buildScene2D(shape.points, shape.closed, style);
  } else {
    const shapeType = $('shape3d-type').value;
    const projectionType = $('projection-type').value;
    const projectionOptions =
      projectionType === 'oblique'
        ? { angleDeg: Number($('oblique-angle').value) || 45, scale: Number($('oblique-scale').value) || 0.5 }
        : {};
    const hiddenLineMode = $('hidden-line-mode').value;
    scene = buildScene3D(shapeType, compute3DShapeParams(), projectionType, projectionOptions, {
      ...style,
      hiddenLineMode,
    });
  }
  currentSvgString = renderSvgString(scene);
  $('preview').innerHTML = currentSvgString;
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

function wireEvents() {
  document.querySelectorAll('.mode-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  $('shape2d-type').addEventListener('change', () => {
    const type = $('shape2d-type').value;
    $('fieldset-regular').hidden = type !== 'regular';
    $('fieldset-triangle').hidden = type !== 'triangle';
    $('fieldset-general').hidden = type !== 'general';
    render();
  });

  $('triangle-method').addEventListener('change', () => {
    const method = $('triangle-method').value;
    $('triangle-sss').hidden = method !== 'sss';
    $('triangle-sas').hidden = method !== 'sas';
    $('triangle-asa').hidden = method !== 'asa';
    render();
  });

  $('general-count').addEventListener('input', () => {
    buildGeneralEdgeInputs();
    render();
  });
  $('general-edges').addEventListener('input', render);

  $('shape3d-type').addEventListener('change', () => {
    buildShape3DFields();
    render();
  });
  $('shape3d-params').addEventListener('input', render);

  $('projection-type').addEventListener('change', () => {
    $('oblique-params').hidden = $('projection-type').value !== 'oblique';
    render();
  });
  $('oblique-angle').addEventListener('input', render);
  $('oblique-scale').addEventListener('input', render);
  $('hidden-line-mode').addEventListener('change', render);

  $('style-fill-mode').addEventListener('change', () => {
    $('style-fill-color').hidden = $('style-fill-mode').value !== 'custom';
    render();
  });

  for (const id of ['style-stroke', 'style-stroke-width', 'style-fill-color']) {
    $(id).addEventListener('input', render);
  }

  document.querySelectorAll('#panel-2d input, #panel-2d select').forEach((el) => {
    el.addEventListener('input', render);
  });

  $('btn-save-svg').addEventListener('click', () => {
    if (!currentSvgString) return;
    downloadSvg(currentSvgString, 'shape.svg');
  });

  $('btn-save-png').addEventListener('click', async () => {
    if (!currentSvgString) return;
    const scaleFactor = Number($('png-resolution').value) || 1;
    const background = $('png-background').value;
    const outputWidth = previewWidth * scaleFactor;
    const outputHeight = previewHeight * scaleFactor;
    try {
      await downloadPng(currentSvgString, { outputWidth, outputHeight, background }, 'shape.png');
    } catch (err) {
      console.error(err);
      alert('PNGの生成に失敗しました: ' + err.message);
    }
  });
}

buildGeneralEdgeInputs();
buildShape3DFields();
wireEvents();
render();
