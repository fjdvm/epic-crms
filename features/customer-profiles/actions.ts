"use server";

import { revalidatePath } from "next/cache";

import { crmsDatabase } from "@/lib/crms-db";
import { database } from "@/lib/db";
import { CUSTOMER_PROFILES_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";

import type { WalkInInput } from "./walk-in-rules";
import { addWalkIn, type AddWalkInResult } from "./walk-ins";

export type AddWalkInActionResult = AddWalkInResult | { ok: false; unavailable: true };

// Server actions are public endpoints, so this proves the Staff member holds the Module.
export async function addWalkInCustomer(input: WalkInInput): Promise<AddWalkInActionResult> {
  await requireModule(CUSTOMER_PROFILES_MODULE);

  try {
    const result = await addWalkIn(database(), crmsDatabase(), input);
    if (result.ok) revalidatePath("/customer-profiles");

    return result;
  } catch (error) {
    console.error("Walk-in Customer could not be saved", error);

    return { ok: false, unavailable: true };
  }
}
