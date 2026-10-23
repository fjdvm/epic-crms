export const SESSION_COOKIE = "creoms_session";
export const HANDOFF_COOKIE = "creoms_handoff";
export const CALLBACK_PATH = "/api/portal/callback";
export const LOGIN_PATH = "/api/portal/login";
export const SIGNING_IN_PATH = "/signing-in";
export const LOGOUT_PATH = "/api/portal/logout";
export const NO_ACCESS_PATH = "/no-access";
export const UNAVAILABLE_PATH = "/unavailable";
export const CUSTOMER_PROFILES_MODULE = "Customer Profiles";
export const TICKETS_MODULE = "Tickets";
export const FEEDBACK_MODULE = "Feedback";
export const MARKETING_MODULE = "Marketing";
export const ORDERS_MODULE = "Orders";
export const PAYMENTS_MODULE = "Payments";
export const FULFILMENT_MODULE = "Fulfilment";
export const RETURNS_MODULE = "Returns";
/** The Order detail page opens for Staff with any of these. */
export const ORDER_DETAIL_MODULES = [ORDERS_MODULE, PAYMENTS_MODULE, FULFILMENT_MODULE, RETURNS_MODULE];

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set; see .env.example`);
  }

  return value;
}

export function portalConfig() {
  const appUrl = (process.env.CREOMS_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

  const portalUrl = required("PORTAL_URL").replace(/\/$/, "");

  return {
    portalUrl,
    systemName: process.env.PORTAL_SYSTEM_NAME ?? "CRMS",
    systemSecret: required("PORTAL_SYSTEM_SECRET"),
    logoutUrl: `${portalUrl}/logout`,
    callbackUrl: `${appUrl}${CALLBACK_PATH}`,
  };
}
