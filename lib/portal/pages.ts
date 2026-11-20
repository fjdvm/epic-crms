import {
  CUSTOMER_PROFILES_MODULE,
  DASHBOARD_MODULE,
  FEEDBACK_MODULE,
  FULFILMENT_MODULE,
  MANAGEMENT_MODULE,
  ORDERS_MODULE,
  PAYMENTS_MODULE,
  RETURNS_MODULE,
  SENIOR_PWD_MODULE,
  TICKETS_MODULE,
} from "./config";

/** The ID checks group on Approvals; the old Senior/PWD checks tab was folded into it. */
export const APPROVALS_ID_CHECKS = "/approvals?type=id-check";

/** The Senior/PWD review pages. Not in the sidebar, but they keep their own Portal Module. */
export const SENIOR_PWD_PAGE = "/customer-profiles/senior-pwd";

/** Every CREOMS page belongs to exactly one Module, in the order `/` tries them. */
export const pages = [
  { href: "/dashboard", module: DASHBOARD_MODULE },
  { href: "/customer-profiles", module: CUSTOMER_PROFILES_MODULE },
  { href: SENIOR_PWD_PAGE, module: SENIOR_PWD_MODULE },
  { href: "/orders", module: ORDERS_MODULE },
  { href: "/orders/stock", module: ORDERS_MODULE },
  { href: "/payments", module: PAYMENTS_MODULE },
  { href: "/fulfilment", module: FULFILMENT_MODULE },
  { href: "/returns", module: RETURNS_MODULE },
  { href: "/tickets", module: TICKETS_MODULE },
  { href: "/conversations", module: TICKETS_MODULE },
  { href: "/feedback", module: FEEDBACK_MODULE },
  { href: "/management/commerce-settings", module: MANAGEMENT_MODULE },
] as const;
