import { CUSTOMER_PROFILES_MODULE } from "./config";

/** Every CREOMS page belongs to exactly one Module, in the order `/` tries them. */
export const pages = [
  { href: "/customer-profiles", module: CUSTOMER_PROFILES_MODULE },
] as const;
