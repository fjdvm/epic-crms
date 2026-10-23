"use server";

import { database } from "@/lib/db";
import { RETURNS_MODULE } from "@/lib/portal/config";
import { requireModule } from "@/lib/portal/staff";
import { loadReturns, loadReturnDetail, loadReturnStats, type ReturnQuery } from "./returns";

/** Each endpoint proves Returns access itself, before opening a database connection. */
export async function getReturns(query: ReturnQuery = {}) {
  await requireModule(RETURNS_MODULE);
  return loadReturns(database, query);
}
export async function getReturnStats() {
  await requireModule(RETURNS_MODULE);
  return loadReturnStats(database);
}
export async function getReturnDetail(id: number) {
  await requireModule(RETURNS_MODULE);
  return loadReturnDetail(database, id);
}
