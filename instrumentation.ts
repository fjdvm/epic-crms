import { devBypassEnabled } from "@/lib/portal/dev-bypass";

/** Runs once at server start, so an unsafe local bypass stops CREOMS from starting at all. */
export function register() {
  devBypassEnabled();
}
