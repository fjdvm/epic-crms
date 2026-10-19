import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { validateSession, type Staff } from "./client";
import { CUSTOMER_PROFILES_MODULE, LOGIN_PATH, SESSION_COOKIE } from "./config";
import { safeReturnTo } from "./return-to";

/**
 * The signed-in Staff member for this request, asked of the Portal once per page load.
 * Without a usable session the visitor is sent to the Portal login and returns here.
 */
export const getStaff = cache(async (): Promise<Staff> => {
  const handle = (await cookies()).get(SESSION_COOKIE)?.value;
  const result = handle
    ? await validateSession(handle, CUSTOMER_PROFILES_MODULE)
    : null;

  if (result?.decision === "allowed") {
    return result.staff;
  }

  if (result?.decision === "denied") {
    redirect("/sign-in-error?reason=denied");
  }

  if (result?.decision === "unavailable") {
    throw new Error("The Portal is temporarily unavailable");
  }

  const returnTo = safeReturnTo((await headers()).get("x-return-to"));
  redirect(`${LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`);
});
