import type { Staff } from "./client";

// URL.hostname keeps the brackets on IPv6 literals.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const DEV_ROLES = ["staff", "manager", "admin", "ceo", "vp"] as const;
export type DevRole = (typeof DEV_ROLES)[number];

/** Which dev user is signed in; set by `/api/dev/role?role=ceo`, only ever read with the bypass on. */
export const DEV_ROLE_COOKIE = "creoms_dev_role";

const DEV_ROLE_NAMES: Record<DevRole, string> = {
  staff: "Staff",
  manager: "CREOMS Manager",
  admin: "Admin",
  ceo: "CEO",
  vp: "VP",
};

export const isDevRole = (value: string | undefined): value is DevRole =>
  DEV_ROLES.some((r) => r === value);

/** The local test user for a Role: Dev Staff, Dev Manager, Dev Admin, Dev CEO or Dev VP (CEO and VP act as a Manager). */
export function devUser(role: DevRole = "staff"): Staff {
  const label = role === "ceo" || role === "vp" ? role.toUpperCase() : role[0].toUpperCase() + role.slice(1);

  return {
    id: `dev-${role}`,
    name: `Dev ${label}`,
    username: `dev.${role}`,
    email: `dev.${role}@localhost`,
    role: DEV_ROLE_NAMES[role],
  };
}

/** The default dev user, Staff. */
export const DEV_STAFF: Staff = devUser("staff");

/**
 * Whether the opt-in local bypass (`CREOMS_DEV_BYPASS=true`) is on. Throws instead of
 * returning when it is on in production or with a deployed origin configured, so a
 * misconfigured deployment fails to start rather than opening CREOMS to the public.
 */
export function devBypassEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.CREOMS_DEV_BYPASS !== "true") {
    return false;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("CREOMS_DEV_BYPASS must not be set in production");
  }

  const appUrl = env.CREOMS_APP_URL;

  if (appUrl && !LOCAL_HOSTS.has(new URL(appUrl).hostname)) {
    throw new Error(
      `CREOMS_DEV_BYPASS must not be set with a deployed CREOMS_APP_URL (${appUrl})`,
    );
  }

  return true;
}
