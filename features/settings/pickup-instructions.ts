import type postgres from "postgres";

import { DEFAULT_COUNTRY, resolveAddress } from "@/lib/psgc";

/** Where and when a Customer collects a Pickup Order: the shop address (shared picker), hours and a free-text note. */
export interface PickupInstructions {
  country: string;
  regionCode: string; provinceCode: string; cityCode: string; barangayCode: string;
  region: string; province: string; city: string; barangay: string;
  street: string;
  hours: string;
  note: string;
}

export type PickupResult = { ok: true; instructions: PickupInstructions } | { ok: false; reason: string };

export const EMPTY_PICKUP: PickupInstructions = {
  country: DEFAULT_COUNTRY, regionCode: "", provinceCode: "", cityCode: "", barangayCode: "",
  region: "", province: "", city: "", barangay: "", street: "", hours: "", note: "",
};

export const PICKUP_LIMITS = { street: 200, hours: 300, note: 1000 } as const;

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Checks the address against the PSGC list and the text limits; returns what to save, with the names filled in. */
export async function validatePickupInstructions(input: unknown): Promise<PickupResult> {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const picked = {
    regionCode: text(raw.regionCode), provinceCode: text(raw.provinceCode), cityCode: text(raw.cityCode), barangayCode: text(raw.barangayCode),
  };
  const resolved = await resolveAddress(picked);
  if (!resolved.ok) return { ok: false, reason: resolved.message };
  const street = text(raw.street), hours = text(raw.hours), note = text(raw.note);
  if (!street) return { ok: false, reason: "Enter the street." };
  if (!hours) return { ok: false, reason: "Enter the pickup hours." };
  if (street.length > PICKUP_LIMITS.street) return { ok: false, reason: `The street can be at most ${PICKUP_LIMITS.street} characters.` };
  if (hours.length > PICKUP_LIMITS.hours) return { ok: false, reason: `The hours can be at most ${PICKUP_LIMITS.hours} characters.` };
  if (note.length > PICKUP_LIMITS.note) return { ok: false, reason: `The note can be at most ${PICKUP_LIMITS.note} characters.` };
  return { ok: true, instructions: { country: DEFAULT_COUNTRY, ...picked, ...resolved.address, street, hours, note } };
}

type Row = Record<keyof PickupInstructions, string>;

const fromRow = (row: Row | undefined): PickupInstructions => (row ? { ...EMPTY_PICKUP, ...row } : EMPTY_PICKUP);

/** The saved instructions, or empty ones when none are saved yet. */
export async function loadPickupInstructions(sql: postgres.Sql): Promise<PickupInstructions> {
  const [row] = await sql<Row[]>`select country, region_code as "regionCode", province_code as "provinceCode", city_code as "cityCode",
    barangay_code as "barangayCode", region, province, city, barangay, street, hours, note
    from crms.pickup_instructions where singleton`;
  return fromRow(row);
}
