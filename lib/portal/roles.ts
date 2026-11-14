import type { Staff } from "./client";

export type ShopRole = "staff" | "manager" | "admin" | "ceo";
/** Portal's existing names remain valid; an unknown Role never acquires shop authority. */
export function shopRole(role: string): ShopRole | null {
  switch (role) {
    case "Staff": case "Staff/Employee": case "Staff / Employee": return "staff";
    case "Manager": case "CRMS Manager": case "CREOMS Manager": return "manager";
    case "Admin": case "Super Admin": return "admin";
    case "CEO": return "ceo";
    default: return null;
  }
}
export function canWork(staff: Staff): boolean {
  return ["staff", "manager"].includes(shopRole(staff.role) ?? "");
}
export function requireShopWriter(staff: Staff): void {
  if (!canWork(staff)) throw new Error("Your Role can only view shop work.");
}
