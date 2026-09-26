// Pure 3D shape data generation. No DOM / SVG / projection dependencies.
// Convention: X = width (right), Y = height (up), Z = depth (toward viewer).
// Polyhedron faces are listed with outward-facing winding (counter-clockwise
// when viewed from outside), used later for hidden-line back-face detection.

function v(x, y, z) {
  return { x, y, z };
}

/** Axis-aligned box centered on the origin (footprint) resting on y=0. */
export function box({ width, height, depth }) {
  const hw = width / 2;
  const hd = depth / 2;
  const vertices = [
    v(-hw, 0, -hd), v(hw, 0, -hd), v(hw, 0, hd), v(-hw, 0, hd), // bottom 0-3
    v(-hw, height, -hd), v(hw, height, -hd), v(hw, height, hd), v(-hw, height, hd), // top 4-7
  ];
  const faces = [
    [0, 1, 2, 3], // bottom (outward normal -Y)
    [7, 6, 5, 4], // top (outward normal +Y)
    [0, 4, 5, 1], // front (-Z)
    [1, 5, 6, 2], // right (+X)
    [2, 6, 7, 3], // back (+Z)
    [3, 7, 4, 0], // left (-X)
  ];
  const edges = facesToEdges(faces);
  return { vertices, edges, faces };
}

export function cube({ size }) {
  return box({ width: size, height: size, depth: size });
}

/** Prism with a regular n-gon base (n=3 triangular, n=4 quadrangular, ...). */
export function prism({ sides, radius, height }) {
  const bottom = [];
  const top = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2;
    const x = radius * Math.cos(angle);
    const z = radius * Math.sin(angle);
    bottom.push(v(x, 0, z));
    top.push(v(x, height, z));
  }
  const vertices = [...bottom, ...top];
  const faces = [];
  faces.push([...Array(sides).keys()].reverse()); // bottom, outward normal -Y
  faces.push([...Array(sides).keys()].map((i) => i + sides)); // top, outward normal +Y
  for (let i = 0; i < sides; i++) {
    const ni = (i + 1) % sides;
    faces.push([i, ni, ni + sides, i + sides]); // side quad, outward
  }
  const edges = facesToEdges(faces);
  return { vertices, edges, faces };
}

export function triangularPrism({ sideLength, height }) {
  const radius = sideLength / (2 * Math.sin(Math.PI / 3));
  return prism({ sides: 3, radius, height });
}

export function quadrangularPrism({ width, depth, height }) {
  return box({ width, height, depth });
}

/** Pyramid with a regular n-gon base and apex above the centroid. */
export function pyramid({ sides, radius, height }) {
  const base = [];
  for (let i = 0; i < sides; i++) {
    const angle = (2 * Math.PI * i) / sides - Math.PI / 2;
    base.push(v(radius * Math.cos(angle), 0, radius * Math.sin(angle)));
  }
  const apex = v(0, height, 0);
  const vertices = [...base, apex];
  const apexIndex = sides;
  const faces = [];
  faces.push([...Array(sides).keys()].reverse()); // base, outward normal -Y
  for (let i = 0; i < sides; i++) {
    const ni = (i + 1) % sides;
    faces.push([i, ni, apexIndex]);
  }
  const edges = facesToEdges(faces);
  return { vertices, edges, faces };
}

export function triangularPyramid({ sideLength, height }) {
  const radius = sideLength / (2 * Math.sin(Math.PI / 3));
  return pyramid({ sides: 3, radius, height });
}

export function quadrangularPyramid({ baseWidth, height }) {
  const radius = (baseWidth * Math.SQRT2) / 2;
  return pyramid({ sides: 4, radius, height });
}

/**
 * Cylinder represented analytically (not polygon-approximated): a bottom
 * circle, a top circle, and the connecting axis. render-svg + ellipse.js
 * project this directly into an ellipse pair with tangent silhouette lines.
 */
export function cylinder({ radius, height }) {
  return {
    kind: 'cylinder',
    radius,
    height,
    bottomCenter: v(0, 0, 0),
    topCenter: v(0, height, 0),
    axis: v(0, 1, 0),
  };
}

/** Cone represented analytically: a base circle plus an apex point. */
export function cone({ radius, height }) {
  return {
    kind: 'cone',
    radius,
    height,
    baseCenter: v(0, 0, 0),
    apex: v(0, height, 0),
    axis: v(0, 1, 0),
  };
}

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Derive a deduplicated edge list, each annotated with its owning faces. */
export function facesToEdges(faces) {
  const map = new Map();
  faces.forEach((face, faceIndex) => {
    for (let i = 0; i < face.length; i++) {
      const a = face[i];
      const b = face[(i + 1) % face.length];
      const key = edgeKey(a, b);
      if (!map.has(key)) {
        map.set(key, { a: Math.min(a, b), b: Math.max(a, b), faces: [] });
      }
      map.get(key).faces.push(faceIndex);
    }
  });
  return [...map.values()];
}
