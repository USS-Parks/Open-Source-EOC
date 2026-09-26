// Generates the exercise scenarios' SYNTHETIC hazard geometry from the
// basemap the app ships, so a tsunami inundation follows the bay shore, a
// flood follows its river and a fire perimeter follows the ground it burned.
// Every shape is exercise content, not official hazard mapping.
//
//   node tools/demo-geometry/generate.mjs [--check]
//
// Reads web/public/basemap (north-coast-terrain.pmtiles, california.pmtiles,
// ca_counties.geojson) and writes server/src/demo/geometry/{cascadia,
// del-norte,deerhorn}.ts. The output depends only on those files and the
// fixed seeds below. --check writes nothing and exits 1 when the committed
// modules differ from a fresh run.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  and, close, components, dilate, distance, drainageUnits, erode, inRing, makeGrid, NEIGHBOURS_8, noise, not, open, or, reach, simplifyLine, spread, tidy, trace,
} from "./grid.mjs";
import { burnLines, burnPolygons, burnRings, crossing, elevation, lines, nearestOnLines, openArchive, points, vectorTiles } from "./sources.mjs";

const BASEMAP = fileURLToPath(new URL("../../web/public/basemap/", import.meta.url));
const OUT = fileURLToPath(new URL("../../server/src/demo/geometry/", import.meta.url));
export const SOURCES = ["north-coast-terrain.pmtiles", "california.pmtiles", "ca_counties.geojson"].map((name) => resolve(BASEMAP, name));

const LAYERS = ["water", "waterway", "transportation", "transportation_name", "boundary", "place"];
const ROADS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service", "track"]);

/** The grid, elevation and vector tiles over one area. */
async function load(archives, bbox, cell) {
  const grid = makeGrid(bbox, cell);
  const elev = await elevation(archives.terrain, grid);
  const tiles = await vectorTiles(archives.streets, grid, LAYERS);
  return { grid, elev, tiles };
}

/** The cells of a county, pulled in by `inset` cells so traced outlines stay inside its outline. */
function county(grid, name, inset = 3) {
  const found = JSON.parse(readFileSync(SOURCES[2], "utf8")).features.find((feature) => feature.properties.name === name);
  const polygons = found.geometry.type === "Polygon" ? [found.geometry.coordinates] : found.geometry.coordinates;
  return erode(burnRings(grid, polygons.map((polygon) => polygon[0])), grid.W, grid.H, inset);
}

/**
 * Fails the run unless every vertex of every shape lies inside the county's
 * outline (the check the seed tests make) and every outer ring has at least
 * 20 vertices.
 */
function assertShapes(shapes, name) {
  const found = JSON.parse(readFileSync(SOURCES[2], "utf8")).features.find((feature) => feature.properties.name === name);
  const outlines = (found.geometry.type === "Polygon" ? [found.geometry.coordinates] : found.geometry.coordinates).map((polygon) => polygon[0]);
  for (const [id, geometry] of Object.entries(shapes)) {
    if (!geometry) throw new Error(`${id}: nothing left to draw`);
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    for (const polygon of polygons) if (polygon[0].length - 1 < 20) throw new Error(`${id}: an outer ring has ${polygon[0].length - 1} vertices`);
    const vertices = geometry.type === "Point" ? [geometry.coordinates] : geometry.type === "LineString" ? geometry.coordinates : polygons.flat(2);
    for (const vertex of vertices) {
      if (!outlines.some((ring) => inRing(ring, vertex))) throw new Error(`${id}: ${vertex} is outside ${name} County`);
    }
  }
}

const roundPoint = ([lon, lat]) => ({ type: "Point", coordinates: [Math.round(lon * 1e5) / 1e5, Math.round(lat * 1e5) / 1e5] });

/** A named road's lines: by route number (`ref`) or by street name. */
const road = (tiles, { ref, name }) =>
  lines(tiles, "transportation_name", (props) => (ref ? String(props.ref) === ref : props.name === name));

/**
 * A point moved onto what it describes: the nearest point of a named road
 * (`road`), the crossing of two roads (`crossing`), or a named pass or peak
 * (`peak`) carried onto a road, each searched near `near`.
 */
async function place(archives, { near, road: which, crossing: pair, peak, bridge }) {
  const d = 0.02;
  const tiles = await vectorTiles(archives.streets, makeGrid([near[0] - d * 1.3, near[1] - d, near[0] + d * 1.3, near[1] + d], 100), LAYERS.concat("mountain_peak"));
  let at = near;
  if (peak) {
    const found = points(tiles, "mountain_peak", (props) => props.name === peak)[0];
    if (!found) throw new Error(`no ${peak} near ${near}`);
    at = found.coords;
  }
  if (pair) {
    const found = crossing(road(tiles, pair[0]), road(tiles, pair[1]), at);
    if (!found) throw new Error(`${JSON.stringify(pair)} do not cross near ${near}`);
    return roundPoint(found);
  }
  const found = nearestOnLines(road(tiles, which), at);
  if (!found || found.distance > 1200) throw new Error(`no ${JSON.stringify(which)} within 1200 m of ${at}`);
  if (bridge) {
    const span = nearestOnLines(lines(tiles, "transportation", (props) => props.brunnel === "bridge" && ROADS.has(props.class)), found.coords);
    if (!span || span.distance > 150) throw new Error(`no bridge on ${JSON.stringify(which)} near ${at}`);
    return roundPoint(span.coords);
  }
  return roundPoint(found.coords);
}

/**
 * A road closure drawn along its road: the stretch of the named road between
 * the points nearest `from` and `to`, found on an 8 m raster of the road so
 * pieces split at tile edges join up, then laid back onto the road's own
 * line and simplified to within about 3 m.
 */
async function alongRoad(archives, which, from, to) {
  const pad = 0.015;
  const grid = makeGrid([Math.min(from[0], to[0]) - pad * 1.3, Math.min(from[1], to[1]) - pad, Math.max(from[0], to[0]) + pad * 1.3, Math.max(from[1], to[1]) + pad], 8);
  const { W, H } = grid;
  const tiles = await vectorTiles(archives.streets, grid, ["transportation_name"]);
  const pieces = road(tiles, which);
  const onRoad = dilate(burnLines(grid, pieces), W, H, 1);
  const nearestCell = ([lon, lat]) => {
    const [x, y] = [grid.x(lon), grid.y(lat)];
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < grid.size; i += 1) {
      const d = onRoad[i] ? Math.hypot((i % W) - x, Math.floor(i / W) - y) : Infinity;
      if (d < bestDistance) [best, bestDistance] = [i, d];
    }
    if (bestDistance * grid.cell > 1500) throw new Error(`no ${JSON.stringify(which)} within 1500 m of ${[lon, lat]}`);
    return best;
  };
  const [start, end] = [nearestCell(from), nearestCell(to)];
  const { arrival } = spread(W, H, [start], (_from, next, length) => (onRoad[next] ? length : Infinity), Infinity, NEIGHBOURS_8);
  if (!(arrival[end] < Infinity)) throw new Error(`${JSON.stringify(which)} does not join ${from} to ${to}`);
  const path = [end];
  for (let at = end; at !== start;) {
    const col = at % W;
    let next = at;
    for (const [dx, dy] of NEIGHBOURS_8) {
      const candidate = at + dy * W + dx;
      if (col + dx < 0 || col + dx >= W || candidate < 0 || candidate >= grid.size) continue;
      if (arrival[candidate] < arrival[next]) next = candidate;
    }
    path.push((at = next));
  }
  const kx = 111320 * Math.cos((from[1] * Math.PI) / 180);
  const ky = 110574;
  const metres = path.reverse().map((i) => {
    const [lon, lat] = nearestOnLines(pieces, [grid.lon(i % W), grid.lat(Math.floor(i / W))]).coords;
    return [lon * kx, lat * ky];
  });
  const line = simplifyLine(metres, 3).map(([x, y]) => [Math.round((x / kx) * 1e5) / 1e5, Math.round((y / ky) * 1e5) / 1e5]);
  return { type: "LineString", coordinates: line.filter((p, i) => i === 0 || p[0] !== line[i - 1][0] || p[1] !== line[i - 1][1]) };
}

/** Every closure of a scenario drawn along its road, by the closure's road label. */
async function closuresAlong(archives, specs) {
  const out = {};
  for (const [label, which, from, to] of specs) out[label] = await alongRoad(archives, which, from, to);
  return out;
}

/** Every point of a scenario placed, by id. */
async function placeAll(archives, specs) {
  const out = {};
  for (const [id, spec] of specs) out[id] = await place(archives, spec);
  return out;
}

/**
 * Splits a mask among named anchors: [[id, [[lon, lat], ...]], ...]. Each
 * cell is nearest (in steps through the mask and `through`) to one anchor;
 * each piece of the mask left when `cuts` (channels) are taken out then goes
 * whole to the id most of its cells are nearest, so the split falls along
 * channels rather than across open ground. Returns an id (or null) per cell.
 */
function byAnchor(grid, anchors, mask, through, cuts) {
  const cells = anchors.flatMap(([id, points]) => points.map(([lon, lat]) => [grid.index(lon, lat), id]));
  const idOf = new Map(cells);
  const passable = or(mask, through);
  const { origin } = spread(grid.W, grid.H, cells.map(([cell]) => cell), (_from, to, length) => (passable[to] ? length : Infinity));
  const nearest = Array.from(origin, (source) => (source >= 0 ? idOf.get(source) : null));
  const { labels, sizes } = components(and(mask, not(cuts)), grid.W, grid.H);
  const votes = sizes.map(() => new Map());
  for (let i = 0; i < grid.size; i += 1) {
    if (labels[i] && nearest[i]) votes[labels[i]].set(nearest[i], (votes[labels[i]].get(nearest[i]) ?? 0) + 1);
  }
  const winner = votes.map((tally) => [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] ?? null);
  return Array.from(labels, (piece, i) => (piece ? winner[piece] : nearest[i]));
}

// ---------------------------------------------------------------------------
// Cascadia Earthquake and Tsunami: Humboldt Bay.

export async function cascadia(archives) {
  const { grid, elev, tiles } = await load(archives, [-124.32, 40.64, -124.02, 40.97], 20);
  const { W, H, cell } = grid;
  const humboldt = county(grid, "Humboldt");
  const ocean = burnPolygons(grid, tiles, "water", (props) => props.class === "ocean");
  const water = burnPolygons(grid, tiles, "water", (props) => props.class !== "swimming_pool");
  // The open ocean is what stays joined to the grid's edge once the bay entrance is pinched shut.
  const pinched = erode(ocean, W, H, 30);
  const edge = Uint8Array.from(pinched, (value, i) => (value && (i % W === 0 || i % W === W - 1 || i < W || i >= W * (H - 1)) ? 1 : 0));
  const openOcean = and(dilate(reach(edge, pinched, W, H), W, H, 32), ocean);
  // Humboldt Bay is the rest of the ocean joined to Arcata Bay; the Eel River estuary is not.
  const bay = reach(Uint8Array.from(ocean, (_, i) => (i === grid.index(-124.13, 40.84) ? 1 : 0)), and(ocean, not(openOcean)), W, H);
  // Near the county line the limit drops away, so the flood stops on the ground before the line.
  const fromLine = distance(not(humboldt), W, H);

  // Run-up falls from about 8.5 m near the entrance to 5 m at the far ends of
  // the bay, and by 1.5 m for each kilometre inland, with seeded variation.
  const entrance = [grid.x(-124.232), grid.y(40.766)];
  const wobble = noise(grid, 101, 40);
  const limit = new Float32Array(grid.size);
  for (let i = 0; i < grid.size; i += 1) {
    const km = (Math.hypot((i % W) - entrance[0], Math.floor(i / W) - entrance[1]) * cell) / 1000;
    limit[i] = Math.min(8.5, Math.max(5, 8.5 - 0.35 * km)) + (wobble[i] - 0.5) * 2.4 - Math.max(0, 12 - fromLine[i]) * 0.8;
  }
  const seeds = [];
  for (let i = 0; i < grid.size; i += 1) if (bay[i]) seeds.push(i);
  const { arrival } = spread(W, H, seeds, (_from, to, length, at) => {
    if (openOcean[to] || !humboldt[to]) return Infinity;
    const km = ((at + length) * cell) / 1000;
    return elev[to] <= limit[to] - 1.5 * km ? length : Infinity;
  });
  const flooded = Uint8Array.from(arrival, (value, i) => (value < Infinity && !ocean[i] ? 1 : 0));

  const inundation = [
    ["south-bay", [[-124.215, 40.735], [-124.2, 40.71]]],
    ["waterfront", [[-124.17, 40.804], [-124.15, 40.795]]],
    ["samoa", [[-124.187, 40.81], [-124.163, 40.848], [-124.21, 40.775]]],
    ["arcata-bottoms", [[-124.11, 40.865], [-124.09, 40.86]]],
  ];
  // Each piece of flooded land between channels goes whole to the anchor most of it is nearest.
  const label = byAnchor(grid, inundation, flooded, bay, water);
  const features = {};
  for (const [id] of inundation) {
    const mask = Uint8Array.from(flooded, (value, i) => (value && label[i] === id ? 1 : 0));
    features[id] = trace(grid, tidy(mask, W, H, 60, 30), { sigma: 1.2, minArea: 40000, minHole: 15000, tolerance: 0.7 });
  }

  // Liquefaction: patches of low fill and bay margin, under about 4.5 m and near the bay shore.
  const nearBay = distance(bay, W, H);
  const patches = noise(grid, 202, 50);
  const nearHighway = distance(burnLines(grid, road(tiles, { ref: "101" })), W, H);
  const liquefaction = [
    ["liq-waterfront", [-124.165, 40.803], 1800, 6, (i) => nearBay[i] < 25],
    ["liq-king-salmon", [-124.212, 40.735], 1300, 4.5, (i) => nearBay[i] < 30],
    ["liq-corridor", [-124.12, 40.835], 4200, 4.5, (i) => nearHighway[i] < 12 && nearBay[i] < 40],
  ];
  for (const [id, [lon, lat], radius, below, near] of liquefaction) {
    const [cx, cy] = [grid.x(lon), grid.y(lat)];
    const mask = new Uint8Array(grid.size);
    for (let i = 0; i < grid.size; i += 1) {
      const within = Math.hypot((i % W) - cx, Math.floor(i / W) - cy) * cell < radius;
      if (within && !ocean[i] && humboldt[i] && fromLine[i] > 6 && elev[i] < below && near(i) && patches[i] > 0.36) mask[i] = 1;
    }
    features[id] = trace(grid, tidy(open(close(mask, W, H, 4), W, H, 2), W, H, 125, 60), { sigma: 1.4, minArea: 50000, minHole: 20000, tolerance: 0.6 });
  }

  // Points on the road or place each one describes.
  const sr299 = { ref: "299" };
  Object.assign(features, await placeAll(archives, [
    ["slide-lord-ellis", { peak: "Lord-Ellis Summit", road: sr299, near: [-123.86, 40.93] }],
    ["slide-berry", { peak: "Berry Summit", road: sr299, near: [-123.77, 40.896] }],
    ["fire-old-town", { crossing: [{ name: "4th Street" }, { name: "E Street" }], near: [-124.1668, 40.8027] }],
    ["fire-waterfront", { road: { name: "Waterfront Drive" }, near: [-124.172, 40.804] }],
    ["fire-plaza", { crossing: [{ name: "9th Street" }, { name: "H Street" }], near: [-124.083, 40.868] }],
    ["fire-fortuna", { road: { name: "Main Street" }, near: [-124.156, 40.598] }],
    ["gas-fortuna", { road: { name: "12th Street" }, near: [-124.155, 40.596] }],
    ["gas-arcata", { road: { name: "Beverly Drive" }, near: [-124.068, 40.86] }],
    ["bridge-samoa", { road: { ref: "255" }, bridge: true, near: [-124.163, 40.814] }],
    ["bridge-mad-river", { road: { ref: "101" }, bridge: true, near: [-124.0925, 40.915] }],
    ["bridge-fernbridge", { road: { ref: "211" }, bridge: true, near: [-124.2025, 40.6125] }],
    ["bridge-blue-lake", { road: { ref: "299" }, bridge: true, near: [-123.998, 40.888] }],
  ]));
  const lordEllis = features["slide-lord-ellis"].coordinates;
  const berry = features["slide-berry"].coordinates;
  const closures = await closuresAlong(archives, [
    ["US-101 between Eureka and Arcata", { ref: "101" }, [-124.155, 40.81], [-124.095, 40.86]],
    ["SR-255 at the Samoa Bridge", { ref: "255" }, [-124.1545, 40.8065], [-124.174, 40.824]],
    ["US-101 at the Mad River bridge", { ref: "101" }, [-124.0965, 40.9275], [-124.0885, 40.9035]],
    ["US-101 at Fields Landing", { ref: "101" }, [-124.21, 40.735], [-124.21, 40.7]],
    ["SR-211 at Fernbridge", { ref: "211" }, [-124.2015, 40.617], [-124.2035, 40.608]],
    ["SR-299 near Lord Ellis Summit", { ref: "299" }, [lordEllis[0] - 0.005, lordEllis[1]], [lordEllis[0] + 0.005, lordEllis[1]]],
    ["SR-299 near Berry Summit", { ref: "299" }, [berry[0] - 0.005, berry[1]], [berry[0] + 0.005, berry[1]]],
    ["SR-299 at the Mad River bridge, Blue Lake", { ref: "299" }, [-124.0025, 40.8892], [-123.9945, 40.8872]],
    ["SR-96 north of Willow Creek", { ref: "96" }, [-123.66, 41.0], [-123.655, 41.01]],
    ["Old Arcata Road", { name: "Old Arcata Road" }, [-124.08, 40.85], [-124.07, 40.84]],
    ["King Salmon Avenue", { name: "King Salmon Avenue" }, [-124.218, 40.742], [-124.214, 40.738]],
  ]);
  return { features, closures };
}

/**
 * Land flooded from `seeds` (cell indices): each cell reached takes the water
 * level of the seed it was reached from, `level(seed)`, less `decay` metres
 * per kilometre travelled, and floods while its ground is under that level
 * (give or take `wobble` metres of seeded variation) and within `maxKm`,
 * never onto `blocked` cells.
 */
function floodFrom(grid, elev, seeds, level, { decay = 0, maxKm = Infinity, wobble = null, blocked = null } = {}) {
  const { W, H, cell } = grid;
  const levels = new Map(seeds.map((seed) => [seed, level(seed)]));
  const { arrival } = spread(W, H, seeds, (_from, to, length, at, source) => {
    const km = ((at + length) * cell) / 1000;
    if (km > maxKm || blocked?.[to]) return Infinity;
    return elev[to] <= levels.get(source) - decay * km + (wobble ? wobble[to] : 0) ? length : Infinity;
  });
  // A seed on blocked ground (a river mouth past the county line) floods inland but is not drawn.
  return Uint8Array.from(arrival, (value, i) => (value < Infinity && !blocked?.[i] ? 1 : 0));
}

/** The lowest ground within `radius` cells of each seed among `cells`: a river's surface without its banks. */
function surface(grid, elev, cells, seeds, radius = 3) {
  const out = new Map();
  for (const seed of seeds) {
    const col = seed % grid.W;
    const row = (seed - col) / grid.W;
    let low = elev[seed];
    for (let r = Math.max(0, row - radius); r <= Math.min(grid.H - 1, row + radius); r += 1) {
      for (let c = Math.max(0, col - radius); c <= Math.min(grid.W - 1, col + radius); c += 1) {
        if (cells[r * grid.W + c]) low = Math.min(low, elev[r * grid.W + c]);
      }
    }
    out.set(seed, low);
  }
  return out;
}

/**
 * An outage area: the local roads within `km` along the road network of
 * each centre, widened by about `buffer` metres and closed into service
 * territory, on land.
 */
function serviceArea(grid, roadCells, land, centres, km, buffer) {
  const { W, H, cell } = grid;
  // Roads within reach of the edge of `land` stay out, so the area ends along roads, not along that edge.
  const inland = distance(not(land), W, H);
  const radius = buffer / cell;
  roadCells = Uint8Array.from(roadCells, (value, i) => (value && inland[i] > radius + 2 ? 1 : 0));
  const starts = centres.map(([lon, lat]) => {
    const target = [grid.x(lon), grid.y(lat)];
    let best = -1;
    let bestDistance = Infinity;
    for (let i = 0; i < grid.size; i += 1) {
      if (!roadCells[i]) continue;
      const d = Math.hypot((i % W) - target[0], Math.floor(i / W) - target[1]);
      if (d < bestDistance) [best, bestDistance] = [i, d];
    }
    return best;
  });
  const { arrival } = spread(W, H, starts, (_from, to, length) => (roadCells[to] ? length : Infinity), (km * 1000) / cell);
  const served = Uint8Array.from(arrival, (value) => (value < Infinity ? 1 : 0));
  return and(close(dilate(served, W, H, radius), W, H, radius * 1.5), land);
}

// ---------------------------------------------------------------------------
// Del Norte Atmospheric Rivers: the Smith River, Lake Earl, the harbor and the lower Klamath.

const LOCAL_ROADS = new Set(["trunk", "primary", "secondary", "tertiary", "minor", "service"]);

export async function delNorte(archives) {
  const features = {};
  {
    const { grid, elev, tiles } = await load(archives, [-124.27, 41.72, -124.07, 41.975], 25);
    const { W, H, cell } = grid;
    const inCounty = county(grid, "Del Norte");
    const fromLine = distance(not(inCounty), W, H);
    const ocean = burnPolygons(grid, tiles, "water", (props) => props.class === "ocean");
    const inland = burnPolygons(grid, tiles, "water", (props) => props.class !== "ocean" && props.class !== "swimming_pool");
    // The Smith's channel: its water and its centre line, not the creeks that join it.
    const channel = and(dilate(burnLines(grid, lines(tiles, "waterway", (props) => String(props.name).startsWith("Smith River"))), W, H, 4), inland);
    burnLines(grid, lines(tiles, "waterway", (props) => String(props.name).startsWith("Smith River")), channel);
    const wobble = Float32Array.from(noise(grid, 303, 30), (value, i) => (value - 0.5) * 1.6 - Math.max(0, 10 - fromLine[i]) * 0.8);
    const blocked = or(ocean, not(inCounty));

    // The Smith River from Fort Dick to the mouth: about 6.5 m over its
    // surface at the upstream end, falling to 4.5 m at the tidal mouth, out
    // over the delta pasture.
    const smithSeeds = [];
    for (let i = 0; i < grid.size; i += 1) {
      if (channel[i] && grid.lat(Math.floor(i / W)) > 41.885 && grid.lon(i % W) < -124.125) smithSeeds.push(i);
    }
    const smithSurface = surface(grid, elev, channel, smithSeeds);
    const smith = floodFrom(grid, elev, smithSeeds, (seed) => {
      const lat = grid.lat(Math.floor(seed / W));
      return smithSurface.get(seed) + 4.5 + Math.min(2, Math.max(0, (41.93 - lat) * 50));
    }, { decay: 0.6, maxKm: 2.5, wobble, blocked });
    features["smith-lower"] = trace(grid, tidy(smith, W, H, 80, 40), { sigma: 1.2, minArea: 60000, minHole: 20000, tolerance: 0.7 });

    // Lake Earl and Lake Talawa about 1.6 m over their surface, onto the low pasture around them.
    const lake = reach(Uint8Array.from(inland, (_, i) => (i === grid.index(-124.18, 41.815) ? 1 : 0)), inland, W, H);
    const lakeSeeds = [];
    for (let i = 0; i < grid.size; i += 1) if (lake[i]) lakeSeeds.push(i);
    const lakeLevel = lakeSeeds.map((i) => elev[i]).sort((a, b) => a - b)[Math.floor(lakeSeeds.length / 2)] + 1.6;
    const earl = floodFrom(grid, elev, lakeSeeds, () => lakeLevel, { decay: 0.4, maxKm: 1.5, wobble, blocked });
    features["lake-earl"] = trace(grid, tidy(earl, W, H, 80, 40), { sigma: 1.2, minArea: 60000, minHole: 20000, tolerance: 0.7 });

    // Harbor surge: king tide, surge and surf about 4.5 m, over the harbor's low ground.
    const harbor = [grid.x(-124.1865), grid.y(41.7455)];
    const harborSeeds = [];
    for (let i = 0; i < grid.size; i += 1) {
      if (ocean[i] && Math.hypot((i % W) - harbor[0], Math.floor(i / W) - harbor[1]) * cell < 700) harborSeeds.push(i);
    }
    const surge = and(floodFrom(grid, elev, harborSeeds, () => 4.5, { decay: 2, maxKm: 0.5, wobble, blocked: not(inCounty) }), not(ocean));
    features.harbor = trace(grid, tidy(surge, W, H, 20, 20), { sigma: 1, minArea: 15000, minHole: 10000, tolerance: 0.5 });

    // Outages follow the local road network out from each community.
    const roadCells = burnLines(grid, lines(tiles, "transportation", (props) => LOCAL_ROADS.has(props.class)));
    const land = and(not(ocean), inCounty);
    const outage = (centres, km) => trace(grid, tidy(serviceArea(grid, roadCells, land, centres, km, 110), W, H, 40, 400), { sigma: 1.5, minArea: 50000, minHole: 150000, tolerance: 0.8 });
    features["crescent-city"] = outage([[-124.2, 41.756], [-124.19, 41.775]], 3);
    features["fort-dick"] = outage([[-124.149, 41.868], [-124.147, 41.928]], 3.2);
  }
  {
    const { grid, elev, tiles } = await load(archives, [-124.1, 41.47, -123.93, 41.575], 20);
    const { W, H } = grid;
    const inCounty = county(grid, "Del Norte");
    const fromLine = distance(not(inCounty), W, H);
    const ocean = burnPolygons(grid, tiles, "water", (props) => props.class === "ocean");
    const inland = burnPolygons(grid, tiles, "water", (props) => props.class !== "ocean" && props.class !== "swimming_pool");
    const channel = and(dilate(burnLines(grid, lines(tiles, "waterway", (props) => String(props.name).startsWith("Klamath River"))), W, H, 6), inland);
    burnLines(grid, lines(tiles, "waterway", (props) => String(props.name).startsWith("Klamath River")), channel);
    const wobble = Float32Array.from(noise(grid, 404, 30), (value, i) => (value - 0.5) * 2 - Math.max(0, 10 - fromLine[i]) * 0.8);
    const blocked = or(ocean, not(inCounty));
    // The lower Klamath from above Klamath Glen to the estuary: about 12.5 m
    // over its surface at the Glen, 8 m at the US-101 bridge, 5 m at the mouth
    // with the king tide.
    const seeds = [];
    for (let i = 0; i < grid.size; i += 1) if (channel[i] && grid.lon(i % W) < -123.975) seeds.push(i);
    const riverSurface = surface(grid, elev, channel, seeds);
    const rise = (lon) => (lon > -124.03 ? 8 + ((lon + 124.03) / 0.04) * 4.5 : 5 + ((lon + 124.075) / 0.045) * 3);
    const klamath = floodFrom(grid, elev, seeds, (seed) => riverSurface.get(seed) + rise(grid.lon(seed % W)), { decay: 1.5, maxKm: 1.3, wobble, blocked });
    features["klamath-glen"] = trace(grid, tidy(klamath, W, H, 80, 40), { sigma: 1.2, minArea: 60000, minHole: 20000, tolerance: 0.7 });
    const roadCells = burnLines(grid, lines(tiles, "transportation", (props) => LOCAL_ROADS.has(props.class)));
    const land = and(not(ocean), inCounty);
    features.klamath = trace(grid, tidy(serviceArea(grid, roadCells, land, [[-124.04, 41.527], [-123.99, 41.516], [-124.07, 41.543]], 2.5, 110), W, H, 40, 400), { sigma: 1.5, minArea: 40000, minHole: 150000, tolerance: 0.8 });
  }
  Object.assign(features, await placeAll(archives, [
    ["last-chance", { road: { ref: "101" }, near: [-124.114, 41.644] }],
    ["patrick-creek", { road: { ref: "199" }, near: [-123.846, 41.872] }],
    ["hiouchi", { road: { ref: "199" }, near: [-124.005, 41.842] }],
    ["howland-hill", { road: { name: "Howland Hill Road" }, near: [-124.139, 41.762] }],
  ]));
  const closures = await closuresAlong(archives, [
    ["US-101 at Last Chance Grade", { ref: "101" }, [-124.1154, 41.6376], [-124.1151, 41.6631]],
    ["US-199 at Patrick Creek", { ref: "199" }, [-123.855, 41.873], [-123.838, 41.878]],
    ["US-199 between Hiouchi and Gasquet", { ref: "199" }, [-124.03, 41.838], [-123.985, 41.845]],
    ["Klamath Beach Road", { name: "Klamath Beach Road" }, [-124.0699, 41.5335], [-124.06, 41.53]],
    ["Terwer Valley Road at Klamath Glen", { name: "Terwer Valley Road" }, [-123.991, 41.527], [-123.985, 41.522]],
    ["Lake Earl Drive", { name: "Lake Earl Drive" }, [-124.1822, 41.79626], [-124.176, 41.81]],
    ["US-101 at the Dr. Fine Bridge", { ref: "101" }, [-124.146, 41.893], [-124.144, 41.899]],
  ]);
  return { features, closures };
}

// ---------------------------------------------------------------------------
// Deerhorn Lightning Complex: the Klamath and Trinity confluence at Weitchpec.

const ACRE = 4046.86;

/**
 * A fire grown from its ignitions over the terrain until it has burned
 * `acres`: each step's rate rises steeply upslope, falls downslope, leans
 * with the wind (`wind`, the direction it blows toward in degrees east of
 * north) and varies with seeded fuel. Water and the sparsest fuel never
 * burn, which leaves unburned islands and fingers. Returns the burned cells.
 */
function burn(grid, elev, ignitions, acres, { wind, windStrength, fuel, unburnable }) {
  const { W, H, cell } = grid;
  const toward = (wind * Math.PI) / 180;
  const [wx, wy] = [Math.sin(toward), -Math.cos(toward)];
  const sources = ignitions.map(([lon, lat]) => grid.index(lon, lat));
  const target = Math.round((acres * ACRE) / (cell * cell));
  const { settled } = spread(W, H, sources, (from, to, length) => {
    if (unburnable[to]) return Infinity;
    const slope = (elev[to] - elev[from]) / (length * cell);
    const upslope = slope > 0 ? Math.min(8, 1 + 12 * slope * slope) : Math.max(0.3, 1 + 1.4 * slope);
    const dx = (to % W) - (from % W);
    const dy = Math.floor(to / W) - Math.floor(from / W);
    const lean = Math.exp((windStrength * (dx * wx + dy * wy)) / length);
    return length / (fuel[to] * upslope * lean);
  }, Infinity, undefined, target);
  const burned = new Uint8Array(grid.size);
  for (const at of settled) burned[at] = 1;
  return burned;
}

/**
 * An evacuation zone built from drainage units: every unit with most of its
 * `land` cells in `core` is taken whole, so the zone's edges fall on ridge
 * lines and rivers, then the zone is cut to `land` (the issuer's own land).
 */
function zone(grid, units, land, core) {
  const inCore = new Float64Array(units.count + 1);
  const total = new Float64Array(units.count + 1);
  for (let i = 0; i < grid.size; i += 1) {
    if (!land[i]) continue;
    total[units.labels[i]] += 1;
    if (core(i)) inCore[units.labels[i]] += 1;
  }
  const taken = Uint8Array.from(units.labels, (label) => (label && total[label] > 0 && inCore[label] / total[label] >= 0.5 ? 1 : 0));
  // Close over the river between taken banks before cutting to the issuer's land.
  return and(close(taken, grid.W, grid.H, 3), land);
}

export async function deerhorn(archives) {
  const { grid, elev, tiles } = await load(archives, [-123.93, 41.04, -123.52, 41.4], 30);
  const { W, H, cell } = grid;
  const humboldt = county(grid, "Humboldt");
  const fromLine = distance(not(humboldt), W, H);
  const water = burnPolygons(grid, tiles, "water", (props) => props.class !== "ocean");
  const tribe = (name) => burnPolygons(grid, tiles, "boundary", (props) => props.class === "aboriginal_lands" && String(props.name).startsWith(name));
  const hoopa = tribe("Hoopa Valley Tribe");
  const yurok = tribe("Yurok Tribe");
  const karuk = tribe("Karuk Tribe");
  const fee = not(or(or(hoopa, yurok), karuk));
  const features = {};

  // The fires: afternoon wind toward the west-southwest after the shift to a
  // northeast wind. The rivers stop them; patchy fuel leaves fingers and islands.
  const rivers = dilate(burnLines(grid, lines(tiles, "waterway", (props) => props.class === "river"), water.slice()), W, H, 1.5);
  const fuelNoise = noise(grid, 505, 10, 5);
  const fuel = Float32Array.from(fuelNoise, (value) => 0.05 + 2.2 * value ** 2.2);
  const sparse = Uint8Array.from(fuelNoise, (value, i) => (value < 0.24 || fromLine[i] < 4 ? 1 : 0));
  // The Bluff Creek and Slate Creek starts were on either bank of the Klamath; embers carried
  // the fire across the river where the two fronts joined.
  const fires = [
    ["deerhorn", [[-123.693213, 41.175669]], 3420, 250, 0.9, false],
    ["bluff-creek", [[-123.665, 41.245], [-123.6495, 41.258]], 1860, 235, 0.7, true],
    ["pecwan", [[-123.835, 41.325]], 410, 240, 0.5, false],
    ["bald-hills", [[-123.79, 41.215]], 95, 240, 0.4, false],
  ];
  let deerhornFire = null;
  for (const [id, ignitions, acres, wind, windStrength, spotsAcrossRivers] of fires) {
    const unburnable = spotsAcrossRivers ? sparse : or(sparse, rivers);
    let burned = burn(grid, elev, ignitions, acres, { wind, windStrength, fuel, unburnable });
    // Fronts that have joined burn out the gap between them.
    if (ignitions.length > 1) burned = or(burned, and(close(burned, W, H, 7), not(unburnable)));
    if (id === "deerhorn") deerhornFire = burned;
    features[id] = trace(grid, tidy(burned, W, H, 20, 4), { sigma: 0.7, minArea: 15000, minHole: 5000, tolerance: 0.3 });
  }

  // Evacuation areas, each issued by one government for its own land, from drainage units.
  const units = drainageUnits(elev, W, H, 500, 60, water);
  const near = (lines, km) => {
    const d = distance(burnLines(grid, lines), W, H);
    return (i) => d[i] * cell <= km * 1000;
  };
  const latOf = (i) => grid.lat(Math.floor(i / W));
  const weitchpec = [grid.x(-123.705), grid.y(41.19)];
  const fromWeitchpec = (i) => (Math.hypot((i % W) - weitchpec[0], Math.floor(i / W) - weitchpec[1]) * cell) / 1000;
  const sr169 = near(road(tiles, { ref: "169" }), 1.6);
  const sr96 = near(road(tiles, { ref: "96" }), 2);
  const nearSr96 = near(road(tiles, { ref: "96" }), 2.5);
  const inHumboldt = (mask) => and(mask, humboldt);
  const weitchpecOrder = inHumboldt(zone(grid, units, yurok, (i) => fromWeitchpec(i) < 3.2));
  const sr169Order = and(inHumboldt(zone(grid, units, yurok, (i) => sr169(i) && fromWeitchpec(i) >= 3.2)), not(weitchpecOrder));
  const hoopaOrder = inHumboldt(zone(grid, units, hoopa, (i) => latOf(i) > 41.098 && nearSr96(i)));
  const countyWarning = inHumboldt(zone(grid, units, fee, (i) => sr96(i) && latOf(i) > 41.195 && latOf(i) < 41.29));
  const zoneShape = (mask) => trace(grid, tidy(mask, W, H, 200, 100), { sigma: 1.2, minArea: 250000, minHole: 100000, tolerance: 0.8 });
  features["yurok-weitchpec"] = zoneShape(weitchpecOrder);
  features["yurok-sr169"] = zoneShape(sr169Order);
  features["hoopa-north"] = zoneShape(hoopaOrder);
  features["county-sr96"] = zoneShape(countyWarning);

  // Spot fires ahead of the Deerhorn Fire's head, on the places each one names:
  // the one across SR-96 lands on the highway just beyond the fire's edge.
  const clear = not(dilate(deerhornFire, W, H, 4));
  const ahead = road(tiles, { ref: "96" }).flatMap(({ coords }) => coords)
    .filter(([lon, lat]) => clear[grid.index(lon, lat)])
    .sort((a, b) => Math.hypot(a[0] + 123.7, a[1] - 41.182) - Math.hypot(b[0] + 123.7, b[1] - 41.182))[0];
  features["spot-sr96"] = roundPoint(ahead);
  Object.assign(features, await placeAll(archives, [
    ["spot-school", { road: { name: "Weitchpec School Road" }, near: [-123.6967, 41.1897] }],
    ["spot-sr169", { crossing: [{ ref: "96" }, { ref: "169" }], near: [-123.715, 41.193] }],
  ]));
  const closures = await closuresAlong(archives, [
    ["SR-96 between Hoopa and Weitchpec", { ref: "96" }, [-123.672, 41.105], [-123.703, 41.186]],
    ["Bald Hills Road", { name: "Bald Hills Road" }, [-123.773, 41.2022], [-123.8155, 41.18]],
    ["Bluff Creek Road", { name: "Bluff Creek Road" }, [-123.6526, 41.2243], [-123.6848, 41.2461]],
    ["SR-169 at Weitchpec", { ref: "169" }, [-123.712, 41.191], [-123.76, 41.222]],
    ["SR-96 from Weitchpec to Orleans", { ref: "96" }, [-123.7, 41.192], [-123.555, 41.298]],
  ]);
  return { features, closures };
}

// ---------------------------------------------------------------------------
// Writing the modules.

const MODULES = [
  ["cascadia.ts", "CASCADIA_GEOMETRY", "the Cascadia Earthquake and Tsunami exercise", cascadia, "Humboldt"],
  ["del-norte.ts", "DEL_NORTE_GEOMETRY", "the Del Norte Atmospheric Rivers exercise", delNorte, "Del Norte"],
  ["deerhorn.ts", "DEERHORN_GEOMETRY", "the Deerhorn Lightning Complex exercise", deerhorn, "Humboldt"],
];

function moduleText(constant, scenario, { features, closures }) {
  const entries = (object) => Object.entries(object).map(([key, geometry]) => `  ${JSON.stringify(key)}: ${JSON.stringify(geometry)},`);
  return [
    "// Generated by tools/demo-geometry/generate.mjs from the shipped basemap; do not edit by hand.",
    `// SYNTHETIC hazard geometry for ${scenario}: exercise content, not official hazard mapping.`,
    `export const ${constant} = {`,
    ...entries(features),
    "};",
    "",
    "/** Each road closure drawn along its road, by the closure's road label. */",
    `export const ${constant.replace("GEOMETRY", "CLOSURES")} = {`,
    ...entries(closures),
    "};",
    "",
  ].join("\n");
}

/** Every module's file name and text, from a fresh run. */
export async function generate() {
  const archives = { terrain: openArchive(SOURCES[0]), streets: openArchive(SOURCES[1]) };
  try {
    const out = [];
    for (const [file, constant, scenario, build, countyName] of MODULES) {
      const built = await build(archives);
      assertShapes({ ...built.features, ...built.closures }, countyName);
      out.push([file, moduleText(constant, scenario, built)]);
    }
    return out;
  } finally {
    archives.terrain.close();
    archives.streets.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const missing = SOURCES.filter((source) => !existsSync(source));
  if (missing.length > 0) {
    console.error(`missing basemap sources: ${missing.join(", ")}`);
    process.exit(2);
  }
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const [file, text] of await generate()) {
    const path = resolve(OUT, file);
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (current === text) continue;
    stale += 1;
    if (check) console.error(`${file} differs from a fresh run`);
    else writeFileSync(path, text);
  }
  if (check && stale > 0) process.exit(1);
  console.log(check ? "geometry modules are current" : `wrote ${stale} geometry module(s)`);
}
