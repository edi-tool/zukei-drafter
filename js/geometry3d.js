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
  // One label per axis, for the "dimensions" annotation (labels one edge
  // instead of every edge that shares a length). `edges` lists every edge of
  // that length so the renderer, which knows which edges the current
  // viewing angle hides, can pick one that is actually visible.
  const dimensions = [
    { edges: [[0, 1], [3, 2], [4, 5], [7, 6]], label: '幅', value: width },
    { edges: [[1, 2], [0, 3], [5, 6], [4, 7]], label: '奥行き', value: depth },
    { edges: [[0, 4], [1, 5], [2, 6], [3, 7]], label: '高さ', value: height },
  ];
  return { vertices, edges: facesToEdges(faces), faces, dimensions };
}

export function cube({ size }) {
  const shape = box({ width: size, height: size, depth: size });
  // All three axes are equal on a cube; one label (on a vertical edge,
  // reliably visible) is enough.
  shape.dimensions = [{ edges: [[0, 4], [1, 5], [2, 6], [3, 7]], label: '一辺', value: size }];
  return shape;
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
  // Every base edge (both the bottom and top n-gon) has the same length,
  // and every vertical edge has the same length; list every one of each so
  // the renderer can pick one that the current viewing angle doesn't hide.
  const baseEdgeLength = 2 * radius * Math.sin(Math.PI / sides);
  const baseEdges = indices.map((i) => [i, (i + 1) % sides]);
  const topEdges = indices.map((i) => [i + sides, ((i + 1) % sides) + sides]);
  const verticalEdges = indices.map((i) => [i, i + sides]);
  const dimensions = [
    { edges: [...baseEdges, ...topEdges], label: '底面の一辺', value: baseEdgeLength },
    { edges: verticalEdges, label: '高さ', value: height },
  ];
  return { vertices, edges: facesToEdges(faces), faces, dimensions };
}

export function triangularPrism({ sideLength, height }) {
  const shape = prism({ sides: 3, radius: sideLength / (2 * Math.sin(Math.PI / 3)), height });
  shape.dimensions[0].value = sideLength; // exact input value, not the radius round-trip
  return shape;
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
  const baseEdgeLength = 2 * radius * Math.sin(Math.PI / sides);
  const baseEdges = [...Array(sides).keys()].map((i) => [i, (i + 1) % sides]);
  const dimensions = [
    { edges: baseEdges, label: '底面の一辺', value: baseEdgeLength },
    // The apex sits above the base centroid, not above any base vertex, so
    // there is no physical edge for the height: a synthetic vertical segment
    // (apex straight down to the base plane) stands in for it, drawn dashed.
    { from: vertices[apex], to: v(0, 0, 0), label: '高さ', value: height, synthetic: true },
  ];
  return { vertices, edges: facesToEdges(faces), faces, dimensions };
}

export function triangularPyramid({ sideLength, height }) {
  const shape = pyramid({ sides: 3, radius: sideLength / (2 * Math.sin(Math.PI / 3)), height });
  shape.dimensions[0].value = sideLength;
  return shape;
}

export function quadrangularPyramid({ baseWidth, height }) {
  const shape = pyramid({ sides: 4, radius: baseWidth / Math.SQRT2, height });
  shape.dimensions[0].value = baseWidth;
  return shape;
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
