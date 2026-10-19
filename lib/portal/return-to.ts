import { CALLBACK_PATH, LOGIN_PATH } from "./config";

const AUTH_PATHS = [CALLBACK_PATH, LOGIN_PATH];

/** Only a local CREOMS page may be returned to, never an arbitrary address or a handoff route. */
export function safeReturnTo(value: string | null | undefined): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\u0000-\u001f\\]/.test(value) ||
    AUTH_PATHS.some((path) => value === path || value.startsWith(`${path}?`))
  ) {
    return "/";
  }

  return value;
}
