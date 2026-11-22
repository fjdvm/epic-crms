import type { Staff } from "./client";

export type ShopRole = "staff" | "manager" | "admin";
/** The owner-level Roles. They act as a Manager in every way but are never assigned Tickets. */
export const OWNER_ROLES: readonly string[] = ["CEO", "VP", "Vice President"];
/**
 * Portal's existing names remain valid; an unknown Role never acquires shop authority.
 * CEO, VP, CREOMS Manager and General Manager have the same access and permissions.
 */
export function shopRole(role: string): ShopRole | null {
  switch (role) {
    case "Staff": case "Staff/Employee": case "Staff / Employee": return "staff";
    case "Manager": case "CRMS Manager": case "CREOMS Manager": case "General Manager":
    case "CEO": case "VP": case "Vice President": return "manager";
    case "Admin": case "Super Admin": return "admin";
    default: return null;
  }
}
export function canWork(staff: Pick<Staff, "role">): boolean {
  return ["staff", "manager"].includes(shopRole(staff.role) ?? "");
}
/** Management is for Manager-level Roles (CEO and VP included); Staff and Admin cannot open it even if a Module reached them. */
export function canManage(staff: Pick<Staff, "role">): boolean {
  return shopRole(staff.role) === "manager";
}
/** Who a Ticket can be assigned to: Staff / Employee, CREOMS Manager and General Manager. Never Admin, CEO, VP or an unknown Role. */
export function isAssignable(role: string): boolean {
  return !OWNER_ROLES.includes(role) && ["staff", "manager"].includes(shopRole(role) ?? "");
}
export const READ_ONLY_REASON = "Your Role can only view shop work.";
export const READ_ONLY_REFUSAL = { ok: false, reason: "read-only" } as const;
