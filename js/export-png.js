// SVG -> Canvas -> PNG export. Browser-only (uses Image/Canvas/Blob), so it
// is exercised manually in the browser rather than under node:test.
// Also provides a plain SVG file download for future/parallel use.

/**
 * Rasterize an SVG string to a PNG Blob at an arbitrary output resolution,
 * independent of how large the on-screen preview is.
 * @param {string} svgString
 * @param {{outputWidth:number, outputHeight:number, background:'transparent'|'white'}} options
 * @returns {Promise<Blob>}
 */
export function svgToPngBlob(svgString, { outputWidth, outputHeight, background = 'transparent' }) {
  return new Promise((resolve, reject) => {
    const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = outputWidth;
        canvas.height = outputHeight;
        const ctx = canvas.getContext('2d');
        if (background === 'white') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, outputWidth, outputHeight);
        }
        ctx.drawImage(img, 0, 0, outputWidth, outputHeight);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error('canvas.toBlob returned null'));
        }, 'image/png');
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('failed to load SVG into an Image for rasterization'));
    };
    img.src = url;
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSvg(svgString, filename) {
  const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
  downloadBlob(blob, filename);
}

export async function downloadPng(svgString, options, filename) {
  const blob = await svgToPngBlob(svgString, options);
  downloadBlob(blob, filename);
}

export const RESOLUTION_PRESETS = [
  { label: '1x', scale: 1 },
  { label: '2x', scale: 2 },
  { label: '4x', scale: 4 },
];
