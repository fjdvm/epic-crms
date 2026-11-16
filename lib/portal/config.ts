export const SESSION_COOKIE = "creoms_session";
export const HANDOFF_COOKIE = "creoms_handoff";
export const CALLBACK_PATH = "/api/portal/callback";
export const LOGIN_PATH = "/api/portal/login";
export const SIGNING_IN_PATH = "/signing-in";
export const LOGOUT_PATH = "/api/portal/logout";
export const NO_ACCESS_PATH = "/no-access";
export const UNAVAILABLE_PATH = "/unavailable";
export const DASHBOARD_MODULE = "Dashboard";
export const CUSTOMER_PROFILES_MODULE = "Customer Profiles";
export const TICKETS_MODULE = "Tickets";
export const FEEDBACK_MODULE = "Feedback";
export const ORDERS_MODULE = "Orders";
export const SENIOR_PWD_MODULE = "Senior/PWD";
export const PAYMENTS_MODULE = "Payments";
export const FULFILMENT_MODULE = "Fulfilment";
export const RETURNS_MODULE = "Returns";
/** The Ticket reports page. Manager, Admin and CEO; the Portal seeds no Staff default. */
export const REPORTS_MODULE = "Reports";
/** The Order detail page opens for Staff with any of these. */
export const ORDER_DETAIL_MODULES = [ORDERS_MODULE, PAYMENTS_MODULE, FULFILMENT_MODULE, RETURNS_MODULE];
/** Data Modules checked by both the Dashboard page and its PDF export. */
export const DASHBOARD_DATA_MODULES = [
  ORDERS_MODULE, PAYMENTS_MODULE, FULFILMENT_MODULE, TICKETS_MODULE,
  RETURNS_MODULE, FEEDBACK_MODULE, CUSTOMER_PROFILES_MODULE,
];

function required(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is not set; see .env.example`);
  }

  return value;
}

/**
 * CREOMS's public origin. Redirects must be built from this, never from `request.url`: behind the
 * container proxy `request.url` carries the bind address (https://0.0.0.0:3000), not the public host.
 */
export function appUrl(): string {
  return (process.env.CREOMS_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export function portalConfig() {

  const portalUrl = required("PORTAL_URL").replace(/\/$/, "");

  return {
    portalUrl,
    systemName: process.env.PORTAL_SYSTEM_NAME ?? "CRMS",
    systemSecret: required("PORTAL_SYSTEM_SECRET"),
    logoutUrl: `${portalUrl}/logout`,
    callbackUrl: `${appUrl()}${CALLBACK_PATH}`,
  };
}
