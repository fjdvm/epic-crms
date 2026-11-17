// Builds lib/psgc/data from the PSGC JSON published at https://psgc.gitlab.io/api (Philippine Statistics Authority list).
// Usage: node scripts/build-psgc.mjs <folder with regions.json provinces.json cities-municipalities.json barangays.json>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [from] = process.argv.slice(2);
if (!from) throw new Error("Pass the folder that holds the four PSGC files.");
const read = (name) => JSON.parse(readFileSync(join(from, name), "utf8"));
const out = join(import.meta.dirname, "..", "lib", "psgc", "data");
mkdirSync(out, { recursive: true });
const byName = (a, b) => a[1].localeCompare(b[1], "en");

const regions = read("regions.json").map((r) => [r.code, r.name]);
const provinces = read("provinces.json").map((p) => [p.code, p.name, p.regionCode]).sort(byName);
const cities = read("cities-municipalities.json").map((c) => [c.code, c.name, c.regionCode, c.provinceCode || ""]).sort(byName);
writeFileSync(join(out, "regions.json"), JSON.stringify(regions));
writeFileSync(join(out, "provinces.json"), JSON.stringify(provinces));
writeFileSync(join(out, "cities.json"), JSON.stringify(cities));

const perRegion = {};
for (const b of read("barangays.json")) {
  const city = b.cityCode || b.municipalityCode;
  if (!city) continue;
  ((perRegion[b.regionCode] ??= {})[city] ??= []).push([b.code, b.name]);
}
for (const [region, cityMap] of Object.entries(perRegion)) {
  for (const list of Object.values(cityMap)) list.sort(byName);
  writeFileSync(join(out, `barangays-${region}.json`), JSON.stringify(cityMap));
}
