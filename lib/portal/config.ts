export const SESSION_COOKIE = "creoms_session";
export const HANDOFF_COOKIE = "creoms_handoff";
export const CALLBACK_PATH = "/api/portal/callback";
export const LOGIN_PATH = "/api/portal/login";
export const NO_ACCESS_PATH = "/no-access";
export const CUSTOMER_PROFILES_MODULE = "Customer Profiles";

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set; see .env.example`);
  }

  return value;
}

export function portalConfig() {
  const appUrl = (process.env.CREOMS_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  return {
    portalUrl: required("PORTAL_URL").replace(/\/$/, ""),
    systemName: process.env.PORTAL_SYSTEM_NAME ?? "CRMS",
    systemSecret: required("PORTAL_SYSTEM_SECRET"),
    callbackUrl: `${appUrl}${CALLBACK_PATH}`,
  };
}
