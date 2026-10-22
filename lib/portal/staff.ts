import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { accessFor } from "./access";
import type { Staff } from "./client";
import { LOGIN_PATH, NO_ACCESS_PATH, ORDER_DETAIL_MODULES, SESSION_COOKIE, UNAVAILABLE_PATH } from "./config";
import { safeReturnTo } from "./return-to";

/** One access checker per page load, so the Portal is asked once however many callers there are. */
const requestAccess = cache(async () =>
  accessFor((await cookies()).get(SESSION_COOKIE)?.value),
);

/** Stops the request when the Portal can't answer or the session is gone; otherwise hands the answer back. */
async function proceed<T extends { decision: string }>(
  result: T,
): Promise<Exclude<T, { decision: "invalid" | "unavailable" }>> {
  if (result.decision === "unavailable") {
    const returnTo = safeReturnTo((await headers()).get("x-return-to"));
    redirect(`${UNAVAILABLE_PATH}?returnTo=${encodeURIComponent(returnTo)}`);
  }

  if (result.decision === "invalid") {
    const returnTo = safeReturnTo((await headers()).get("x-return-to"));
    redirect(`${LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return result as Exclude<T, { decision: "invalid" | "unavailable" }>;
}

/**
 * Call at the top of every page and data-loading action. Layouts do not re-run on client
 * navigation, so the page itself must prove the Staff member holds its Module.
 */
export async function requireModule(module: string): Promise<Staff> {
  const access = await requestAccess();
  const result = await proceed(await access.check(module));

  if (result.decision === "denied") {
    redirect(NO_ACCESS_PATH);
  }

  return result.staff;
}

/** Like requireModule, for a page that opens with any one of several Modules. */
export async function requireAnyModule(modules: readonly string[]): Promise<Staff> {
  const access = await requestAccess();
  const result = await proceed(await access.checkAny(modules));

  if (result.decision === "denied") {
    redirect(NO_ACCESS_PATH);
  }

  return result.staff;
}

/** Which of these Modules the Staff member holds, so a page shows only the actions they allow. */
export async function heldModules(modules: readonly string[]): Promise<string[]> {
  const access = await requestAccess();
  const results = await Promise.all(modules.map((module) => access.check(module)));

  // A Module the Portal could not answer is not held: hiding a button is safe, and the action checks again.
  return modules.filter((_, i) => results[i].decision === "allowed");
}

/** Whether the Staff member may open the Order detail page, for pages that link to it but don't need it. */
export async function canOpenOrders(): Promise<boolean> {
  const result = await proceed(await (await requestAccess()).checkAny(ORDER_DETAIL_MODULES));

  return result.decision === "allowed";
}

/** The Staff member and the pages they may open, for the shell. No Module at all means no access. */
export async function getShell(): Promise<{ staff: Staff; permittedPages: string[] }> {
  const result = await proceed(await (await requestAccess()).overview());

  if (result.decision === "denied") {
    redirect(NO_ACCESS_PATH);
  }

  return { staff: result.staff, permittedPages: result.pages };
}

/** Where `/` goes: the first page the Staff member may open, or the "no access" page. */
export async function homePage(): Promise<string> {
  const result = await proceed(await (await requestAccess()).overview());

  return result.decision === "allowed" ? result.pages[0] : NO_ACCESS_PATH;
}
