// Pure 3D shape data generation. No DOM / SVG / projection dependencies.
// Convention: X = width, Y = height (up), Z = depth. Solids rest on y = 0.
// Polyhedron faces are wound counter-clockwise when viewed from outside, so
// the cross product (v1 - v0) x (v2 - v0) is the outward normal.

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
    [0, 1, 2, 3], // bottom (-Y)
    [7, 6, 5, 4], // top (+Y)
    [0, 4, 5, 1], // -Z
    [1, 5, 6, 2], // +X
    [2, 6, 7, 3], // +Z
    [3, 7, 4, 0], // -X
  ];
  return { vertices, edges: facesToEdges(faces), faces };
}

export function cube({ size }) {
  return box({ width: size, height: size, depth: size });
}

// Regular n-gon in the x-z plane with one edge facing -Z (the front in
// oblique drawings), so e.g. a square base is axis-aligned, not a diamond.
function regularBase(sides, radius, y) {
  const start = -Math.PI / 2 - Math.PI / sides;
  const points = [];
  for (let i = 0; i < sides; i++) {
    const angle = start + (2 * Math.PI * i) / sides;
    points.push(v(radius * Math.cos(angle), y, radius * Math.sin(angle)));
  }
  return points;
}

/** Prism with a regular n-gon base (n=3 triangular, n=4 quadrangular, ...). */
export function prism({ sides, radius, height }) {
  const vertices = [...regularBase(sides, radius, 0), ...regularBase(sides, radius, height)];
  const indices = [...Array(sides).keys()];
  const faces = [
    indices, // bottom: increasing angle in x-z is clockwise seen from +Y, so this faces -Y
    indices.map((i) => i + sides).reverse(), // top
  ];
  for (let i = 0; i < sides; i++) {
    const ni = (i + 1) % sides;
    faces.push([i, i + sides, ni + sides, ni]);
  }
  return { vertices, edges: facesToEdges(faces), faces };
}

export function triangularPrism({ sideLength, height }) {
  return prism({ sides: 3, radius: sideLength / (2 * Math.sin(Math.PI / 3)), height });
}

export function quadrangularPrism({ width, depth, height }) {
  return box({ width, height, depth });
}

/** Pyramid with a regular n-gon base and apex above the centroid. */
export function pyramid({ sides, radius, height }) {
  const vertices = [...regularBase(sides, radius, 0), v(0, height, 0)];
  const apex = sides;
  const faces = [[...Array(sides).keys()]];
  for (let i = 0; i < sides; i++) {
    faces.push([i, apex, (i + 1) % sides]);
  }
  return { vertices, edges: facesToEdges(faces), faces };
}

export function triangularPyramid({ sideLength, height }) {
  return pyramid({ sides: 3, radius: sideLength / (2 * Math.sin(Math.PI / 3)), height });
}

export function quadrangularPyramid({ baseWidth, height }) {
  return pyramid({ sides: 4, radius: baseWidth / Math.SQRT2, height });
}

/**
 * Cylinder kept analytic (not polygon-approximated); curved-solids.js turns
 * it into exact projected ellipses plus silhouette generator lines.
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

/** Deduplicated edge list, each edge annotated with the faces that own it. */
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
