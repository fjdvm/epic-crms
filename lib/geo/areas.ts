import cities from "@/lib/psgc/data/cities.json";
import provinces from "@/lib/psgc/data/provinces.json";

/** Lower-case, accent-free, single-spaced: how Province names are compared. Keep in step with scripts/build-ph-map.mjs. */
export function areaKey(name: string): string {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export const METRO_MANILA = "metro manila";

const NAMES = new Map<string, string>([
  ...(provinces as string[][]).map(([, name]) => [areaKey(name), name] as [string, string]),
  [METRO_MANILA, "Metro Manila"],
]);

/** Cities that sit under no Province in lib/psgc, and the map area they lie in. */
const INDEPENDENT = new Map<string, string>([
  ...(cities as string[][]).filter((c) => c[2] === "130000000").map(([, name]) => [areaKey(name), METRO_MANILA] as [string, string]),
  ["city of cotabato", "maguindanao"],
  ["city of isabela", "basilan"],
]);
/** Newer Province names, mapped to the ones lib/psgc and the map use. */
const ALIASES = new Map([["maguindanao del norte", "maguindanao"], ["maguindanao del sur", "maguindanao"], ["ncr", METRO_MANILA]]);

/**
 * The map area of a delivery address: its Province, or Metro Manila for an address with no Province,
 * or the Province an independent city lies in. Null when the Province is not a known one.
 */
export function addressArea(province: string, city: string): string | null {
  const p = areaKey(province);
  if (p) {
    const key = ALIASES.get(p) ?? p;
    return NAMES.has(key) ? key : null;
  }
  return INDEPENDENT.get(areaKey(city)) ?? null;
}

/** The name to show for an area key. */
export function areaName(key: string): string {
  return NAMES.get(key) ?? key;
}

/** A city's name without "City of" or "City", for matching an address to lib/geo/ph-cities.json. Keep in step with scripts/build-ph-cities.mjs. */
export function cityKey(name: string): string {
  return areaKey(name).replace(/^city of /, "").replace(/ city$/, "");
}

/** The name to show for a city: "City of Makati" reads as "Makati". */
export function cityLabel(name: string): string {
  return name.trim().replace(/^City of /i, "");
}
