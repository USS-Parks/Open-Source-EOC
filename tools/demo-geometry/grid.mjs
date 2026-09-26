// Raster tools for the exercise scenarios' synthetic hazard geometry: a grid
// of square cells over a small area, seeded noise, distances, fills and
// spreads over the cells, and tracing a mask into simplified GeoJSON
// polygons. Pure functions with no I/O, so the same input always gives the
// same output.

/**
 * A grid over [west, south, east, north] with cells about `cell` metres on a
 * side. Row 0 is the north edge. x and y are fractional column and row, with
 * a cell's centre at whole numbers.
 */
export function makeGrid([west, south, east, north], cell) {
  const lat0 = ((south + north) / 2) * (Math.PI / 180);
  const dx = cell / (111320 * Math.cos(lat0));
  const dy = cell / 110574;
  const W = Math.ceil((east - west) / dx);
  const H = Math.ceil((north - south) / dy);
  return {
    west, north, dx, dy, W, H, cell, size: W * H,
    lon: (x) => west + (x + 0.5) * dx,
    lat: (y) => north - (y + 0.5) * dy,
    x: (lon) => (lon - west) / dx - 0.5,
    y: (lat) => (north - lat) / dy - 0.5,
    /** The index of the cell holding a point, or -1 outside the grid. */
    index(lon, lat) {
      const col = Math.round(this.x(lon));
      const row = Math.round(this.y(lat));
      return col < 0 || row < 0 || col >= W || row >= H ? -1 : row * W + col;
    },
  };
}

function lattice(ix, iy, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1103515245);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Seeded fractal value noise in [0, 1]; `scale` is the largest feature in cells. */
export function noise(grid, seed, scale, octaves = 4) {
  const { W, H } = grid;
  const out = new Float32Array(W * H);
  let amplitude = 1;
  let total = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const step = scale / 2 ** octave;
    const salt = seed * 31 + octave;
    for (let row = 0; row < H; row += 1) {
      const fy = row / step;
      const iy = Math.floor(fy);
      const ty = (fy - iy) * (fy - iy) * (3 - 2 * (fy - iy));
      for (let col = 0; col < W; col += 1) {
        const fx = col / step;
        const ix = Math.floor(fx);
        const tx = (fx - ix) * (fx - ix) * (3 - 2 * (fx - ix));
        const top = lattice(ix, iy, salt) * (1 - tx) + lattice(ix + 1, iy, salt) * tx;
        const bottom = lattice(ix, iy + 1, salt) * (1 - tx) + lattice(ix + 1, iy + 1, salt) * tx;
        out[row * W + col] += amplitude * (top * (1 - ty) + bottom * ty);
      }
    }
    total += amplitude;
    amplitude /= 2;
  }
  for (let i = 0; i < out.length; i += 1) out[i] /= total;
  return out;
}

function distance1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Euclidean distance in cells from each cell to the nearest set cell of `mask`. */
export function distance(mask, W, H) {
  const far = 1e12;
  const n = Math.max(W, H);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  const grid = new Float64Array(W * H);
  for (let i = 0; i < W * H; i += 1) grid[i] = mask[i] ? 0 : far;
  for (let col = 0; col < W; col += 1) {
    for (let row = 0; row < H; row += 1) f[row] = grid[row * W + col];
    distance1d(f, H, d, v, z);
    for (let row = 0; row < H; row += 1) grid[row * W + col] = d[row];
  }
  const out = new Float32Array(W * H);
  for (let row = 0; row < H; row += 1) {
    for (let col = 0; col < W; col += 1) f[col] = grid[row * W + col];
    distance1d(f, W, d, v, z);
    for (let col = 0; col < W; col += 1) out[row * W + col] = Math.sqrt(d[col]);
  }
  return out;
}

/** Cells within `radius` cells of the mask (a round dilation). */
export function dilate(mask, W, H, radius) {
  const d = distance(mask, W, H);
  return Uint8Array.from(d, (value) => (value <= radius ? 1 : 0));
}

/** Cells farther than `radius` cells from outside the mask (a round erosion). */
export function erode(mask, W, H, radius) {
  const d = distance(Uint8Array.from(mask, (value) => (value ? 0 : 1)), W, H);
  return Uint8Array.from(d, (value) => (value > radius ? 1 : 0));
}

/** Dilate then erode: closes gaps and notches narrower than about twice `radius`. */
export function close(mask, W, H, radius) {
  return erode(dilate(mask, W, H, radius), W, H, radius);
}

/** Erode then dilate: removes spurs and specks narrower than about twice `radius`. */
export function open(mask, W, H, radius) {
  return dilate(erode(mask, W, H, radius), W, H, radius);
}

export const and = (a, b) => Uint8Array.from(a, (value, i) => (value && b[i] ? 1 : 0));
export const or = (a, b) => Uint8Array.from(a, (value, i) => (value || b[i] ? 1 : 0));
export const not = (a) => Uint8Array.from(a, (value) => (value ? 0 : 1));

/** A binary min-heap of cell indices keyed by cost. */
export class Heap {
  constructor() {
    this.keys = [];
    this.values = [];
  }
  get size() {
    return this.keys.length;
  }
  push(key, value) {
    const { keys, values } = this;
    let i = keys.length;
    keys.push(key);
    values.push(value);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (keys[parent] < keys[i] || (keys[parent] === keys[i] && values[parent] <= values[i])) break;
      [keys[parent], keys[i]] = [keys[i], keys[parent]];
      [values[parent], values[i]] = [values[i], values[parent]];
      i = parent;
    }
  }
  pop() {
    const { keys, values } = this;
    const top = [keys[0], values[0]];
    const lastKey = keys.pop();
    const lastValue = values.pop();
    if (keys.length > 0) {
      keys[0] = lastKey;
      values[0] = lastValue;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        const less = (a, b) => keys[a] < keys[b] || (keys[a] === keys[b] && values[a] < values[b]);
        if (l < keys.length && less(l, m)) m = l;
        if (r < keys.length && less(r, m)) m = r;
        if (m === i) break;
        [keys[m], keys[i]] = [keys[i], keys[m]];
        [values[m], values[i]] = [values[i], values[m]];
        i = m;
      }
    }
    return top;
  }
}

/** The eight neighbours, then the eight knight's moves, as [dx, dy, length]. */
export const NEIGHBOURS_16 = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
  [2, 1], [2, -1], [-2, 1], [-2, -1], [1, 2], [1, -2], [-1, 2], [-1, -2],
].map(([dx, dy]) => [dx, dy, Math.hypot(dx, dy)]);
export const NEIGHBOURS_8 = NEIGHBOURS_16.slice(0, 8);

/**
 * Least-cost arrival over the grid from `sources` (cell indices, arriving at
 * 0). `cost(from, to, length)` prices one step in cell lengths and returns
 * Infinity for a step that cannot be taken. Arrivals past `limit` stay
 * Infinity, and the spread stops once `stopAfter` cells have been settled.
 * Returns the arrival and, for each reached cell, the source it was reached
 * from, and the cells in the order they settled.
 */
export function spread(W, H, sources, cost, limit = Infinity, neighbours = NEIGHBOURS_16, stopAfter = Infinity) {
  const arrival = new Float64Array(W * H).fill(Infinity);
  const origin = new Int32Array(W * H).fill(-1);
  const heap = new Heap();
  for (const source of sources) {
    arrival[source] = 0;
    origin[source] = source;
    heap.push(0, source);
  }
  const settled = [];
  while (heap.size > 0 && settled.length < stopAfter) {
    const [at, cell] = heap.pop();
    if (at > arrival[cell]) continue;
    settled.push(cell);
    const col = cell % W;
    const row = (cell - col) / W;
    for (const [dx, dy, length] of neighbours) {
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= W || r >= H) continue;
      const next = r * W + c;
      const step = cost(cell, next, length, at, origin[cell]);
      if (!(step < Infinity)) continue;
      const t = at + step;
      if (t < arrival[next] && t <= limit) {
        arrival[next] = t;
        origin[next] = origin[cell];
        heap.push(t, next);
      }
    }
  }
  return { arrival, origin, settled };
}

/**
 * Drainage units: every cell drains, over the depression-filled surface, to
 * the neighbour a priority flood from the grid's edge reached it from; cells
 * draining at least `streamCells` cells are streams, cut into links at each
 * confluence and every `linkCells` cells; each cell belongs to the link it
 * drains into. Cells of `barrier` (a river's water) split a unit into its
 * banks. Returns a unit label per cell (0 on the barrier) and the count.
 * Units meet along ridgelines and rivers.
 */
export function drainageUnits(elev, W, H, streamCells, linkCells, barrier) {
  const parent = new Int32Array(W * H).fill(-1);
  const order = new Int32Array(W * H);
  const seen = new Uint8Array(W * H);
  const heap = new Heap();
  for (let i = 0; i < W * H; i += 1) {
    const col = i % W;
    const row = (i - col) / W;
    if (col === 0 || row === 0 || col === W - 1 || row === H - 1) {
      seen[i] = 1;
      heap.push(elev[i], i);
    }
  }
  let n = 0;
  while (heap.size > 0) {
    const [level, cell] = heap.pop();
    order[n++] = cell;
    const col = cell % W;
    const row = (cell - col) / W;
    for (const [dx, dy] of NEIGHBOURS_8) {
      const c = col + dx;
      const r = row + dy;
      if (c < 0 || r < 0 || c >= W || r >= H) continue;
      const next = r * W + c;
      if (seen[next]) continue;
      seen[next] = 1;
      parent[next] = cell;
      heap.push(Math.max(elev[next], level + 1e-4), next);
    }
  }
  const drained = new Float64Array(W * H).fill(1);
  for (let k = n - 1; k >= 0; k -= 1) if (parent[order[k]] >= 0) drained[parent[order[k]]] += drained[order[k]];
  const stream = Uint8Array.from(drained, (value) => (value >= streamCells ? 1 : 0));
  const streamChildren = new Int32Array(W * H);
  for (let i = 0; i < W * H; i += 1) if (stream[i] && parent[i] >= 0) streamChildren[parent[i]] += 1;
  const link = new Int32Array(W * H);
  const linkLength = [0];
  const unit = new Int32Array(W * H);
  for (let k = 0; k < n; k += 1) {
    const cell = order[k];
    const up = parent[cell];
    if (stream[cell]) {
      if (up >= 0 && stream[up] && streamChildren[up] === 1 && linkLength[link[up]] < linkCells) {
        link[cell] = link[up];
        linkLength[link[cell]] += 1;
      } else {
        link[cell] = linkLength.length;
        linkLength.push(1);
      }
      unit[cell] = link[cell];
    } else if (up >= 0) unit[cell] = unit[up];
    else {
      unit[cell] = linkLength.length;
      linkLength.push(0);
    }
  }
  // Split each unit at the barrier: its pieces on either bank become units of their own.
  const labels = new Int32Array(W * H);
  let count = 0;
  const stack = [];
  for (let i = 0; i < W * H; i += 1) {
    if (labels[i] || barrier[i]) continue;
    count += 1;
    labels[i] = count;
    stack.push(i);
    while (stack.length > 0) {
      const cell = stack.pop();
      const col = cell % W;
      for (const next of [cell - W, cell + W, col > 0 ? cell - 1 : -1, col < W - 1 ? cell + 1 : -1]) {
        if (next < 0 || next >= W * H || labels[next] || barrier[next] || unit[next] !== unit[cell]) continue;
        labels[next] = count;
        stack.push(next);
      }
    }
  }
  return { labels, count };
}

/** Cells of `passable` connected to any seed cell (4-connected); seeds are kept. */
export function reach(seeds, passable, W, H) {
  const out = new Uint8Array(W * H);
  const stack = [];
  for (let i = 0; i < W * H; i += 1) if (seeds[i]) {
    out[i] = 1;
    stack.push(i);
  }
  while (stack.length > 0) {
    const cell = stack.pop();
    const col = cell % W;
    for (const next of [cell - W, cell + W, col > 0 ? cell - 1 : -1, col < W - 1 ? cell + 1 : -1]) {
      if (next < 0 || next >= W * H || out[next] || !passable[next]) continue;
      out[next] = 1;
      stack.push(next);
    }
  }
  return out;
}

/** 4-connected components of a mask: labels (0 is background, 1..n) and each one's cell count. */
export function components(mask, W, H) {
  const labels = new Int32Array(W * H);
  const sizes = [0];
  const stack = [];
  for (let i = 0; i < W * H; i += 1) {
    if (!mask[i] || labels[i]) continue;
    const label = sizes.length;
    let size = 0;
    labels[i] = label;
    stack.push(i);
    while (stack.length > 0) {
      const cell = stack.pop();
      size += 1;
      const col = cell % W;
      for (const next of [cell - W, cell + W, col > 0 ? cell - 1 : -1, col < W - 1 ? cell + 1 : -1]) {
        if (next < 0 || next >= W * H || labels[next] || !mask[next]) continue;
        labels[next] = label;
        stack.push(next);
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/** The mask without components smaller than `minCells`, and with holes smaller than `minHole` filled. */
export function tidy(mask, W, H, minCells, minHole = minCells) {
  const kept = new Uint8Array(W * H);
  const parts = components(mask, W, H);
  for (let i = 0; i < W * H; i += 1) kept[i] = parts.labels[i] && parts.sizes[parts.labels[i]] >= minCells ? 1 : 0;
  const gaps = components(not(kept), W, H);
  const touchesEdge = new Set();
  for (let col = 0; col < W; col += 1) touchesEdge.add(gaps.labels[col]).add(gaps.labels[(H - 1) * W + col]);
  for (let row = 0; row < H; row += 1) touchesEdge.add(gaps.labels[row * W]).add(gaps.labels[row * W + W - 1]);
  for (let i = 0; i < W * H; i += 1) {
    const label = gaps.labels[i];
    if (label && !touchesEdge.has(label) && gaps.sizes[label] < minHole) kept[i] = 1;
  }
  return kept;
}

/** A separable Gaussian blur of a field (or a 0/1 mask) with `sigma` in cells. */
export function blur(field, W, H, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)));
  const sum = kernel.reduce((a, b) => a + b, 0);
  const weights = kernel.map((k) => k / sum);
  const pass = (input, horizontal) => {
    const out = new Float32Array(W * H);
    for (let row = 0; row < H; row += 1) {
      for (let col = 0; col < W; col += 1) {
        let total = 0;
        for (let k = -radius; k <= radius; k += 1) {
          const c = horizontal ? Math.min(W - 1, Math.max(0, col + k)) : col;
          const r = horizontal ? row : Math.min(H - 1, Math.max(0, row + k));
          total += weights[k + radius] * input[r * W + c];
        }
        out[row * W + col] = total;
      }
    }
    return out;
  };
  return pass(pass(field, true), false);
}

// Marching squares segments by case, as pairs of edges: 0 top, 1 right, 2 bottom, 3 left.
// Cases 5 and 10 are saddles resolved by the square's centre value.
const CASES = {
  1: [[3, 2]], 2: [[2, 1]], 3: [[3, 1]], 4: [[0, 1]], 6: [[0, 2]], 7: [[0, 3]], 8: [[0, 3]],
  9: [[0, 2]], 11: [[0, 1]], 12: [[3, 1]], 13: [[1, 2]], 14: [[3, 2]],
};

/** Closed contour rings of `field` at `level`, in fractional grid x and y. Outside the grid reads as below. */
export function contours(field, W, H, level) {
  const outside = level - 1;
  const value = (col, row) => (col < 0 || row < 0 || col >= W || row >= H ? outside : field[row * W + col]);
  const stride = W + 2;
  const points = new Map();
  const links = new Map();
  const edge = (col, row, side) => {
    // Top and bottom edges are horizontal, left and right vertical; each is keyed by its first corner.
    const [c, r, vertical] = side === 0 ? [col, row, 0] : side === 1 ? [col + 1, row, 1] : side === 2 ? [col, row + 1, 0] : [col, row, 1];
    const key = ((r + 1) * stride + (c + 1)) * 2 + vertical;
    if (!points.has(key)) {
      const a = value(c, r);
      const b = vertical ? value(c, r + 1) : value(c + 1, r);
      const clamped = Math.min(1, Math.max(0, (level - a) / (b - a)));
      points.set(key, vertical ? [c, r + clamped] : [c + clamped, r]);
    }
    return key;
  };
  const link = (a, b) => {
    if (!links.has(a)) links.set(a, []);
    if (!links.has(b)) links.set(b, []);
    links.get(a).push(b);
    links.get(b).push(a);
  };
  for (let row = -1; row < H; row += 1) {
    for (let col = -1; col < W; col += 1) {
      const tl = value(col, row);
      const tr = value(col + 1, row);
      const br = value(col + 1, row + 1);
      const bl = value(col, row + 1);
      const index = (tl > level ? 8 : 0) | (tr > level ? 4 : 0) | (br > level ? 2 : 0) | (bl > level ? 1 : 0);
      if (index === 0 || index === 15) continue;
      let pairs = CASES[index];
      if (index === 5 || index === 10) {
        const high = (tl + tr + br + bl) / 4 > level;
        pairs = index === 5
          ? (high ? [[0, 3], [1, 2]] : [[0, 1], [3, 2]])
          : (high ? [[0, 1], [3, 2]] : [[0, 3], [1, 2]]);
      }
      for (const [a, b] of pairs) link(edge(col, row, a), edge(col, row, b));
    }
  }
  const rings = [];
  const seen = new Set();
  for (const start of [...links.keys()].sort((a, b) => a - b)) {
    if (seen.has(start)) continue;
    const ring = [];
    let previous = -1;
    let at = start;
    while (!seen.has(at)) {
      seen.add(at);
      ring.push(points.get(at));
      const [a, b] = links.get(at);
      const next = a !== previous ? a : b;
      previous = at;
      at = next;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

/** Twice the signed area of a ring of [x, y] (positive when counterclockwise with y up). */
export function signedArea(ring) {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return sum;
}

export function inRing(ring, [x, y]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Douglas-Peucker simplification of an open line, keeping both ends. */
export function simplifyLine(points, tolerance) {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop();
    const [ax, ay] = points[first];
    const [bx, by] = points[last];
    const dx = bx - ax;
    const dy = by - ay;
    const length2 = dx * dx + dy * dy;
    let worst = -1;
    let worstDistance = tolerance * tolerance;
    for (let i = first + 1; i < last; i += 1) {
      const [px, py] = points[i];
      const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d2 = ex * ex + ey * ey;
      if (d2 > worstDistance) {
        worstDistance = d2;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Douglas-Peucker simplification of a closed ring (not repeating its first point). */
export function simplifyRing(ring, tolerance) {
  if (ring.length <= 4) return ring;
  let far = 0;
  let farDistance = -1;
  for (let i = 1; i < ring.length; i += 1) {
    const d = (ring[i][0] - ring[0][0]) ** 2 + (ring[i][1] - ring[0][1]) ** 2;
    if (d > farDistance) {
      farDistance = d;
      far = i;
    }
  }
  const first = simplifyLine(ring.slice(0, far + 1), tolerance);
  const second = simplifyLine([...ring.slice(far), ring[0]], tolerance);
  return [...first, ...second.slice(1, -1)];
}

function segmentsCross([ax, ay], [bx, by], [cx, cy], [dx, dy]) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) return true;
  const on = (px, py, qx, qy, rx, ry) => Math.min(px, qx) <= rx && rx <= Math.max(px, qx) && Math.min(py, qy) <= ry && ry <= Math.max(py, qy);
  if (d1 === 0 && on(cx, cy, dx, dy, ax, ay)) return true;
  if (d2 === 0 && on(cx, cy, dx, dy, bx, by)) return true;
  if (d3 === 0 && on(ax, ay, bx, by, cx, cy)) return true;
  if (d4 === 0 && on(ax, ay, bx, by, dx, dy)) return true;
  return false;
}

/**
 * Whether any two edges of the rings touch or cross, other than neighbouring
 * edges of one ring meeting at their shared vertex. Rings are closed
 * (first point repeated last).
 */
export function ringsIntersect(rings) {
  const segments = [];
  rings.forEach((ring, r) => {
    for (let i = 0; i < ring.length - 1; i += 1) {
      const a = ring[i];
      const b = ring[i + 1];
      segments.push({ r, i, n: ring.length - 1, a, b, min: Math.min(a[0], b[0]), max: Math.max(a[0], b[0]) });
    }
  });
  segments.sort((s, t) => s.min - t.min || s.r - t.r || s.i - t.i);
  for (let s = 0; s < segments.length; s += 1) {
    const one = segments[s];
    for (let t = s + 1; t < segments.length && segments[t].min <= one.max; t += 1) {
      const two = segments[t];
      if (one.r === two.r) {
        const gap = Math.abs(one.i - two.i);
        if (gap === 1 || gap === one.n - 1) continue;
      }
      if (segmentsCross(one.a, one.b, two.a, two.b)) return true;
    }
  }
  return false;
}

/**
 * A mask traced into a GeoJSON Polygon or MultiPolygon, or null when nothing
 * is left. The mask is blurred by `sigma` cells and contoured at one half,
 * parts under `minArea` square metres and holes under `minHole` are dropped,
 * and each ring is simplified to at most `maxVertices` and, for outer rings,
 * at least `minVertices`. Outer rings run counterclockwise and holes
 * clockwise (RFC 7946); coordinates are rounded to 1e-5 degrees.
 */
export function trace(grid, mask, { sigma = 1, minArea = 20000, minHole = 20000, tolerance = 0.6, maxVertices = 400, minVertices = 20 } = {}) {
  const { W, H, cell } = grid;
  const field = blur(Float32Array.from(mask), W, H, sigma);
  const cellArea = cell * cell;
  const rings = contours(field, W, H, 0.5)
    .map((ring) => ({ ring, area: Math.abs(signedArea(ring)) / 2 * cellArea }))
    .filter(({ area }) => area >= Math.min(minArea, minHole));
  // Nesting depth decides shells (even) and holes (odd).
  for (const one of rings) {
    one.depth = rings.filter((other) => other !== one && other.area > one.area && inRing(other.ring, one.ring[0])).length;
  }
  const shells = rings.filter((one) => one.depth % 2 === 0 && one.area >= minArea).sort((a, b) => b.area - a.area);
  const polygons = shells.map((shell) => ({ shell, holes: [] }));
  for (const hole of rings.filter((one) => one.depth % 2 === 1 && one.area >= minHole)) {
    const parent = polygons
      .filter(({ shell }) => shell.depth === hole.depth - 1 && shell.area > hole.area && inRing(shell.ring, hole.ring[0]))
      .sort((a, b) => a.shell.area - b.shell.area)[0];
    if (parent) parent.holes.push(hole);
  }
  if (polygons.length === 0) return null;
  const toLonLat = (ring, outer) => {
    const points = ring.map(([x, y]) => [Math.round(grid.lon(x) * 1e5) / 1e5, Math.round(grid.lat(y) * 1e5) / 1e5]);
    const same = (a, b) => a[0] === b[0] && a[1] === b[1];
    let deduped = points.filter((p, i) => i === 0 || !same(p, points[i - 1]));
    if (deduped.length > 1 && same(deduped[0], deduped.at(-1))) deduped.pop();
    // Rounding can fold a vertex back onto its neighbour's neighbour: drop such spikes.
    for (let changed = true; changed && deduped.length > 3;) {
      const n = deduped.length;
      const next = deduped.filter((p, i) => !same(deduped[(i + n - 1) % n], deduped[(i + 1) % n]));
      changed = next.length !== n;
      deduped = next.filter((p, i) => i === 0 || !same(p, next[i - 1]));
    }
    const counterclockwise = signedArea(deduped) > 0;
    if (counterclockwise !== outer) deduped.reverse();
    return [...deduped, deduped[0]];
  };
  const fit = (ring, outer, scale) => {
    let t = tolerance * scale;
    let simple = simplifyRing(ring, t);
    for (let guard = 0; simple.length > maxVertices && guard < 30; guard += 1) simple = simplifyRing(ring, (t *= 1.25));
    for (let guard = 0; outer && simple.length < minVertices && t > 0.01 && guard < 30; guard += 1) simple = simplifyRing(ring, (t /= 1.5));
    return toLonLat(simple, outer);
  };
  for (let scale = 1; scale > 0.02; scale /= 2) {
    const built = polygons.map(({ shell, holes }) => [fit(shell.ring, true, scale), ...holes.map((hole) => fit(hole.ring, false, scale))]);
    if (!ringsIntersect(built.flat())) {
      return built.length === 1 ? { type: "Polygon", coordinates: built[0] } : { type: "MultiPolygon", coordinates: built };
    }
  }
  throw new Error("could not trace a valid polygon");
}
