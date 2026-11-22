import { describe, expect, it } from "vitest";
import { listBarangays, listCities, listProvinces, listRegions, NO_PROVINCE, resolveAddress } from "@/lib/psgc";

describe("PSGC lists", () => {
  it("has every region", () => expect(listRegions()).toHaveLength(17));
  it("narrows provinces by region", () => {
    const calabarzon = listRegions().find((r) => r.name === "CALABARZON")!;
    expect(listProvinces(calabarzon.code).map((p) => p.name)).toContain("Laguna");
    expect(listProvinces(calabarzon.code).map((p) => p.name)).not.toContain("Cebu");
  });
  it("offers 'no province' for Metro Manila and lists its cities under it", () => {
    const ncr = listRegions().find((r) => r.code === "130000000")!;
    expect(listProvinces(ncr.code).map((p) => p.code)).toEqual([NO_PROVINCE]);
    expect(listCities(ncr.code, NO_PROVINCE).map((c) => c.name)).toContain("City of Manila");
  });
  it("narrows barangays by city and is empty for unknown codes", async () => {
    expect((await listBarangays("130000000", "133900000")).length).toBeGreaterThan(100);
    expect(await listBarangays("130000000", "nope")).toEqual([]);
    expect(await listBarangays("../../x", "1")).toEqual([]);
  });
});

describe("resolveAddress", () => {
  it("returns the names for a consistent pick", async () => {
    const barangay = (await listBarangays("130000000", "133900000"))[0];
    const result = await resolveAddress({ regionCode: "130000000", provinceCode: NO_PROVINCE, cityCode: "133900000", barangayCode: barangay.code });
    expect(result).toEqual({ ok: true, address: { region: "NCR", province: "", city: "City of Manila", barangay: barangay.name } });
  });
  it("refuses a barangay that belongs to another city", async () => {
    const other = (await listBarangays("130000000", "137404000"))[0];
    const result = await resolveAddress({ regionCode: "130000000", provinceCode: NO_PROVINCE, cityCode: "133900000", barangayCode: other.code });
    expect(result).toEqual({ ok: false, message: "Choose a Barangay that belongs to the City." });
  });
  it("refuses a city outside the province", async () => {
    const calabarzon = listRegions().find((r) => r.name === "CALABARZON")!.code;
    const result = await resolveAddress({ regionCode: calabarzon, provinceCode: listProvinces(calabarzon)[0].code, cityCode: "133900000", barangayCode: "x" });
    expect(result.ok).toBe(false);
  });
});
