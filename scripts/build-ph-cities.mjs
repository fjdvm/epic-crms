// Builds lib/geo/ph-cities.json: the city and municipality outlines of Metro Manila and the Provinces around it
// (Bulacan, Rizal, Cavite, Laguna), with a label point for each, for the zoomed-in AI insights map.
// Source: the low-resolution "municities-provdist-*.0.001.json" files of https://github.com/faeldon/philippines-json-maps
// (MIT licence, PSA/NAMRIA boundaries), folder latest/geojson/provdists/lowres. The files needed are
// 1303900000, 1307400000, 1307500000, 1307600000 (Metro Manila), 301400000 (Bulacan), 402100000 (Cavite),
// 403400000 (Laguna) and 405800000 (Rizal).
// Usage: node scripts/build-ph-cities.mjs <folder with those files>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// The same projection as scripts/build-ph-map.mjs, so the outlines sit exactly on the Province map.
const WEST = 116.9, NORTH = 21.2, EAST = 126.7, WIDTH = 400;
const K = Math.cos((12 * Math.PI) / 180);
const scale = WIDTH / ((EAST - WEST) * K);
const point = ([lon, lat]) => [(lon - WEST) * K * scale, (NORTH - lat) * scale];

// Keep in step with areaKey() and cityKey() in lib/geo/areas.ts.
const key = (name) => name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const cityKey = (name) => key(name).replace(/^city of /, "").replace(/ city$/, "");
const label = (name) => name.replace(/^City of /, "");
const PROVINCES = { 13: "metro manila", 301400000: "bulacan", 402100000: "cavite", 403400000: "laguna", 405800000: "rizal" };
const provinceOf = (p) => PROVINCES[p.adm1_psgc === 1300000000 ? 13 : p.adm2_psgc];

const round = (v) => Math.round(v * 100) / 100;
function ring(coords) {
  let d = "";
  let last = null;
  for (const c of coords) {
    const [x, y] = point(c).map(round);
    if (last && Math.abs(last[0] - x) < 0.02 && Math.abs(last[1] - y) < 0.02) continue;
    d += `${d ? "L" : "M"}${x} ${y}`;
    last = [x, y];
  }
  return d ? `${d}Z` : "";
}
/** Area-weighted centre of the largest ring, a good enough place for a label and a bubble. */
function centre(rings) {
  let best = null;
  for (const r of rings) {
    const pts = r.map(point);
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
      const f = x0 * y1 - x1 * y0;
      a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
    }
    if (a === 0) continue;
    if (!best || Math.abs(a) > Math.abs(best.a)) best = { a, x: cx / (3 * a), y: cy / (3 * a) };
  }
  return best ? [round(best.x), round(best.y)] : null;
}

const [from] = process.argv.slice(2);
if (!from) throw new Error("Pass the folder that holds the municities-provdist files.");

const cities = [];
for (const file of readdirSync(from).filter((f) => f.endsWith(".json")).sort()) {
  for (const feature of JSON.parse(readFileSync(join(from, file), "utf8")).features) {
    const p = feature.properties;
    const province = provinceOf(p);
    if (!province) continue;
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const outer = polygons.map((poly) => poly[0]);
    const at = centre(outer);
    if (!at) continue;
    cities.push({ province, key: cityKey(p.adm3_en), name: label(p.adm3_en), x: at[0], y: at[1], d: outer.map(ring).join("") });
  }
}
cities.sort((a, b) => a.province.localeCompare(b.province) || a.key.localeCompare(b.key));

const out = { source: "faeldon/philippines-json-maps (MIT), PSA/NAMRIA boundaries", cities };
writeFileSync(join(import.meta.dirname, "..", "lib", "geo", "ph-cities.json"), JSON.stringify(out));
console.log(`${cities.length} cities`);
