import { CUSTOMER_PROFILES_MODULE, TICKETS_MODULE } from "./config";

/** Every CREOMS page belongs to exactly one Module, in the order `/` tries them. */
export const pages = [
  { href: "/customer-profiles", module: CUSTOMER_PROFILES_MODULE },
  { href: "/tickets", module: TICKETS_MODULE },
  { href: "/conversations", module: TICKETS_MODULE },
] as const;
