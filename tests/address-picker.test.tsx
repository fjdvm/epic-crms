// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddressPicker, type AddressPick, type LoadOptions, type LegacyAddress } from "@/components/shared/address-picker";

afterEach(cleanup);

const DATA = {
  region: [{ code: "R1", name: "Region One" }, { code: "R2", name: "Region Two" }],
  "province:R1": [{ code: "P1", name: "Province One" }, { code: "P2", name: "Province Two" }],
  "province:R2": [{ code: "none", name: "No province" }],
  "city:P1": [{ code: "C1", name: "City One" }],
  "city:none": [{ code: "C9", name: "Metro City" }],
  "barangay:C1": [{ code: "B1", name: "Barangay One" }],
  "barangay:C9": [{ code: "B9", name: "Barangay Nine" }],
} as Record<string, { code: string; name: string }[]>;

const loader = (): LoadOptions => vi.fn(async (q) => {
  const key = q.level === "region" ? "region" : q.level === "province" ? `province:${q.region}` : q.level === "city" ? `city:${q.province}` : `barangay:${q.city}`;
  return DATA[key] ?? [];
});

describe("AddressPicker", () => {
  it("defaults Country to the Philippines and shows loading placeholders at once", () => {
    render(<AddressPicker loadOptions={() => new Promise(() => {})} />);
    expect((screen.getByLabelText("Country") as HTMLSelectElement).value).toBe("Philippines");
    expect(screen.getByTestId("region-loading")).toBeTruthy();
  });

  it("cascades Region, Province, City and Barangay, each narrowing the next", async () => {
    const onChange = vi.fn();
    render(<AddressPicker loadOptions={loader()} onChange={onChange} />);
    const region = (await screen.findByLabelText("Region")) as HTMLSelectElement;
    expect((screen.getByLabelText("Province") as HTMLSelectElement).disabled).toBe(true);

    await userEvent.selectOptions(region, "R1");
    const province = (await screen.findByLabelText("Province")) as HTMLSelectElement;
    await waitFor(() => expect(province.disabled).toBe(false));
    expect(Array.from(province.options).map((o) => o.text)).toContain("Province Two");

    await userEvent.selectOptions(province, "P1");
    const city = (await screen.findByLabelText("City")) as HTMLSelectElement;
    await waitFor(() => expect(city.disabled).toBe(false));
    expect(Array.from(city.options).map((o) => o.text)).not.toContain("Metro City");

    await userEvent.selectOptions(city, "C1");
    const barangay = (await screen.findByLabelText("Barangay")) as HTMLSelectElement;
    await waitFor(() => expect(barangay.disabled).toBe(false));
    await userEvent.selectOptions(barangay, "B1");
    await userEvent.type(screen.getByLabelText("Street"), "12 Rizal St.");

    const last = onChange.mock.lastCall![0] as AddressPick;
    expect(last).toMatchObject({ country: "Philippines", regionCode: "R1", provinceCode: "P1", cityCode: "C1", barangayCode: "B1", street: "12 Rizal St." });
  });

  it("clears the lower picks when a higher one changes", async () => {
    const onChange = vi.fn();
    render(<AddressPicker loadOptions={loader()} onChange={onChange} />);
    await userEvent.selectOptions(await screen.findByLabelText("Region"), "R1");
    await waitFor(() => expect((screen.getByLabelText("Province") as HTMLSelectElement).disabled).toBe(false));
    await userEvent.selectOptions(screen.getByLabelText("Province"), "P1");
    await waitFor(() => expect((screen.getByLabelText("City") as HTMLSelectElement).disabled).toBe(false));
    await userEvent.selectOptions(screen.getByLabelText("City"), "C1");
    await userEvent.selectOptions(screen.getByLabelText("Region"), "R2");
    expect(onChange.mock.lastCall![0]).toMatchObject({ regionCode: "R2", cityCode: "", barangayCode: "" });
  });

  it("picks the only Province by itself, as for Metro Manila", async () => {
    render(<AddressPicker loadOptions={loader()} />);
    await userEvent.selectOptions(await screen.findByLabelText("Region"), "R2");
    await waitFor(() => expect((screen.getByLabelText("Province") as HTMLSelectElement).value).toBe("none"));
    await waitFor(() => expect((screen.getByLabelText("City") as HTMLSelectElement).options.length).toBeGreaterThan(1));
  });

  it("applies the Street mask", async () => {
    render(<AddressPicker loadOptions={loader()} />);
    await userEvent.type(await screen.findByLabelText("Street"), "5 <Oak>");
    expect((screen.getByLabelText("Street") as HTMLInputElement).value).toBe("5 Oak");
  });

  it("says so when a list cannot load", async () => {
    render(<AddressPicker loadOptions={() => Promise.reject(new Error("x"))} />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  describe("an old free-text address", () => {
    const legacy: LegacyAddress = { street: "1 Mabini St", barangay: "Poblacion", city: "Pasig", province: "Metro Manila", country: "Philippines" };

    it("shows as plain text, with no dropdowns, until edited", () => {
      render(<AddressPicker legacy={legacy} loadOptions={loader()} />);
      expect(screen.getByText("1 Mabini St, Poblacion, Pasig, Metro Manila, Philippines")).toBeTruthy();
      expect(screen.queryByLabelText("Region")).toBeNull();
    });

    it("asks for a fresh pick when edited", async () => {
      render(<AddressPicker legacy={legacy} loadOptions={loader()} />);
      await userEvent.click(screen.getByRole("button", { name: "Change address" }));
      expect(await screen.findByLabelText("Region")).toBeTruthy();
      expect(screen.getByRole("note").textContent).toContain("Pick it again from the lists");
      expect((screen.getByLabelText("Street") as HTMLInputElement).value).toBe("");
    });
  });

  it("is read-only for Admin and CEO: text only, no edit button", () => {
    const legacy: LegacyAddress = { street: "1 Mabini St", barangay: "Poblacion", city: "Pasig", province: "Metro Manila", country: "Philippines" };
    render(<AddressPicker legacy={legacy} readOnly loadOptions={loader()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByLabelText("Region")).toBeNull();
  });
});
