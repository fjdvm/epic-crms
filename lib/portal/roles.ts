import type { Staff } from "./client";

export type ShopRole = "staff" | "manager" | "admin" | "ceo";
/** Portal's existing names remain valid; an unknown Role never acquires shop authority. */
export function shopRole(role: string): ShopRole | null {
  switch (role) {
    case "Staff": case "Staff/Employee": case "Staff / Employee": return "staff";
    case "Manager": case "CRMS Manager": case "CREOMS Manager": case "General Manager": return "manager";
    case "Admin": case "Super Admin": return "admin";
    case "CEO": return "ceo";
    default: return null;
  }
}
export function canWork(staff: Pick<Staff, "role">): boolean {
  return ["staff", "manager"].includes(shopRole(staff.role) ?? "");
}
/** Management is for a Manager or the CEO; Staff and Admin cannot open it even if a Module reached them. */
export function canManage(staff: Pick<Staff, "role">): boolean {
  return ["manager", "ceo"].includes(shopRole(staff.role) ?? "");
}
/** Who a Ticket can be assigned to: Staff / Employee, CREOMS Manager and General Manager. Never Admin, CEO, VP or an unknown Role. */
export function isAssignable(role: string): boolean {
  return ["staff", "manager"].includes(shopRole(role) ?? "");
}
export const READ_ONLY_REASON = "Your Role can only view shop work.";
export const READ_ONLY_REFUSAL = { ok: false, reason: "read-only" } as const;
