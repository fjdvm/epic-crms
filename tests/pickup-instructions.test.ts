import { beforeEach, describe, expect, it, vi } from "vitest";

import { listBarangays, listCities, listProvinces, listRegions } from "@/lib/psgc";
import { validatePickupInstructions } from "@/features/settings/pickup-instructions";
import { savePickupInstructions } from "@/features/settings/pickup-instructions-server";

async function pick() {
  const region = listRegions()[0];
  const province = listProvinces(region.code)[0];
  const city = listCities(region.code, province.code)[0];
  const barangay = (await listBarangays(region.code, city.code))[0];
  return { regionCode: region.code, provinceCode: province.code, cityCode: city.code, barangayCode: barangay.code, street: "12 Rizal St", hours: "Mon-Sat 9am-5pm", note: "Ring the bell" };
}

describe("validatePickupInstructions", () => {
  it("fills the names from the picked codes", async () => {
    const result = await validatePickupInstructions(await pick());
    expect(result.ok && result.instructions.region).toBe(listRegions()[0].name);
  });
  it("refuses a missing address, street or hours, and a barangay from another city", async () => {
    const good = await pick();
    expect((await validatePickupInstructions({ ...good, regionCode: "" })).ok).toBe(false);
    expect((await validatePickupInstructions({ ...good, barangayCode: "nope" })).ok).toBe(false);
    expect((await validatePickupInstructions({ ...good, street: " " })).ok).toBe(false);
    expect((await validatePickupInstructions({ ...good, hours: "" })).ok).toBe(false);
    expect((await validatePickupInstructions({ ...good, note: "x".repeat(1001) })).ok).toBe(false);
    expect((await validatePickupInstructions(null)).ok).toBe(false);
  });
});

describe("savePickupInstructions", () => {
  const audit = vi.fn();
  const sql = Object.assign(vi.fn(async () => []), {});
  beforeEach(() => { vi.clearAllMocks(); });

  it.each(["Staff/Employee", "CRMS Manager", "CEO"])("refuses %s and writes nothing", async role => {
    const result = await savePickupInstructions(sql as never, audit as never, { id: "s", name: "S", role }, await pick());
    expect(result).toEqual({ ok: false, reason: "Only an Admin can change the Pickup instructions." });
    expect(sql).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("refuses an invalid address for an Admin without saving", async () => {
    const result = await savePickupInstructions(sql as never, audit as never, { id: "a", name: "Ada", role: "Super Admin" }, { ...(await pick()), regionCode: "" });
    expect(result.ok).toBe(false);
    expect(sql).not.toHaveBeenCalled();
  });

  it("saves for an Admin and audits under their name", async () => {
    const result = await savePickupInstructions(sql as never, audit as never, { id: "a", name: "Ada", role: "Super Admin" }, await pick());
    expect(result.ok).toBe(true);
    expect(sql).toHaveBeenCalledTimes(2); // read previous, then write
    expect(audit).toHaveBeenCalled();
  });
});
