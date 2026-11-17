import cities from "./data/cities.json";
import provinces from "./data/provinces.json";
import regions from "./data/regions.json";

/** One entry of the Philippine Standard Geographic Code list the address pickers use. */
export interface PsgcOption { code: string; name: string }

/** Cities and municipalities that sit under no Province (Metro Manila, independent cities) use this code. */
export const NO_PROVINCE = "none";
export const DEFAULT_COUNTRY = "Philippines";

const option = ([code, name]: readonly string[]): PsgcOption => ({ code, name });
const REGION_CODES = new Set((regions as string[][]).map(([code]) => code));

export function listRegions(): PsgcOption[] {
  return (regions as string[][]).map(option);
}

/** Provinces of a Region, plus the "no province" choice when the Region has cities outside any Province. */
export function listProvinces(regionCode: string): PsgcOption[] {
  const list = (provinces as string[][]).filter((p) => p[2] === regionCode).map(option);
  const hasIndependent = (cities as string[][]).some((c) => c[2] === regionCode && !c[3]);
  return hasIndependent ? [...list, { code: NO_PROVINCE, name: "No province (independent cities)" }] : list;
}

export function listCities(regionCode: string, provinceCode: string): PsgcOption[] {
  const wanted = provinceCode === NO_PROVINCE ? "" : provinceCode;
  return (cities as string[][]).filter((c) => c[2] === regionCode && c[3] === wanted).map(option);
}

/** Barangays of a city or municipality; empty for an unknown Region or city. */
export async function listBarangays(regionCode: string, cityCode: string): Promise<PsgcOption[]> {
  if (!REGION_CODES.has(regionCode)) return [];
  const byCity = (await import(`./data/barangays-${regionCode}.json`)).default as Record<string, string[][]>;
  return (byCity[cityCode] ?? []).map(option);
}

export interface AddressSelection { regionCode: string; provinceCode: string; cityCode: string; barangayCode: string }
export interface ResolvedAddress { region: string; province: string; city: string; barangay: string }

/** Checks each pick belongs to the one above it and returns the names to save, or the message to show. */
export async function resolveAddress(s: AddressSelection): Promise<{ ok: true; address: ResolvedAddress } | { ok: false; message: string }> {
  const region = listRegions().find((r) => r.code === s.regionCode);
  if (!region) return { ok: false, message: "Choose a Region from the list." };
  const province = listProvinces(region.code).find((p) => p.code === s.provinceCode);
  if (!province) return { ok: false, message: "Choose a Province that belongs to the Region." };
  const city = listCities(region.code, province.code).find((c) => c.code === s.cityCode);
  if (!city) return { ok: false, message: "Choose a City that belongs to the Province." };
  const barangay = (await listBarangays(region.code, city.code)).find((b) => b.code === s.barangayCode);
  if (!barangay) return { ok: false, message: "Choose a Barangay that belongs to the City." };
  return { ok: true, address: { region: region.name, province: province.code === NO_PROVINCE ? "" : province.name, city: city.name, barangay: barangay.name } };
}
