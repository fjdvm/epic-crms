// Builds lib/geo/ph-provinces.json: one SVG path per Province of lib/psgc, for the AI Insights map.
// Source: the low-resolution "provdists-region-*.0.001.json" files of https://github.com/faeldon/philippines-json-maps
// (MIT licence, PSA/NAMRIA boundaries), folder latest/geojson/regions/lowres.
// Usage: node scripts/build-ph-map.mjs <folder with the provdists-region files>
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";


// Keep in step with areaKey() in lib/geo/areas.ts; tests/ai-insights-areas.test.ts checks every PSGC Province has a shape.
const key = (name) => name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// The boundary files follow the 2023 PSGC; lib/psgc still has ARMM's undivided Maguindanao, and NCR has no Province.
function mapAreaName(name) {
  if (name.startsWith("NCR")) return "metro manila";
  if (name.startsWith("Maguindanao")) return "maguindanao";
  if (name.startsWith("City of Isabela")) return "basilan";
  if (name === "Special Geographic Area") return "cotabato";
  return key(name);
}

const [from] = process.argv.slice(2);
if (!from) throw new Error("Pass the folder that holds the provdists-region files.");

// Equirectangular, with longitude scaled by cos(12°) so the country keeps its shape.
const WEST = 116.9, EAST = 126.7, NORTH = 21.2, SOUTH = 4.5, WIDTH = 400;
const K = Math.cos((12 * Math.PI) / 180);
const scale = WIDTH / ((EAST - WEST) * K);
const HEIGHT = Math.round((NORTH - SOUTH) * scale);
const point = ([lon, lat]) => [(lon - WEST) * K * scale, (NORTH - lat) * scale];

function ring(coords) {
  let d = "";
  let last = null;
  for (const c of coords) {
    const [x, y] = point(c).map((v) => Math.round(v * 10) / 10);
    if (last && Math.abs(last[0] - x) < 0.4 && Math.abs(last[1] - y) < 0.4) continue;
    d += `${d ? "L" : "M"}${x} ${y}`;
    last = [x, y];
  }
  return d.length > 0 ? `${d}Z` : "";
}

const shapes = new Map();
for (const file of readdirSync(from).filter((f) => f.endsWith(".json")).sort()) {
  for (const feature of JSON.parse(readFileSync(join(from, file), "utf8")).features) {
    const area = mapAreaName(feature.properties.adm2_en);
    if (!area) continue;
    const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
    const d = polygons.map((p) => ring(p[0])).filter((r) => r.length > 12).join("");
    shapes.set(area, (shapes.get(area) ?? "") + d);
  }
}

const out = {
  source: "faeldon/philippines-json-maps (MIT), PSA/NAMRIA boundaries",
  viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
  shapes: [...shapes].sort(([a], [b]) => a.localeCompare(b, "en")).map(([key, d]) => ({ key, d })),
};
writeFileSync(join(import.meta.dirname, "..", "lib", "geo", "ph-provinces.json"), JSON.stringify(out));
console.log(`${out.shapes.length} areas, viewBox ${out.viewBox}`);
