import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { accessFor } from "./access";
import type { Staff, Validation } from "./client";
import { LOGIN_PATH, NO_ACCESS_PATH, SESSION_COOKIE } from "./config";
import { pages } from "./pages";
import { safeReturnTo } from "./return-to";

/** One access checker per page load, so the Portal is asked once however many callers there are. */
const requestAccess = cache(async () =>
  accessFor((await cookies()).get(SESSION_COOKIE)?.value),
);

async function settle(result: Validation): Promise<Extract<Validation, { decision: "allowed" | "denied" }>> {
  if (result.decision === "unavailable") {
    throw new Error("The Portal is temporarily unavailable");
  }

  if (result.decision === "invalid") {
    const returnTo = safeReturnTo((await headers()).get("x-return-to"));
    redirect(`${LOGIN_PATH}?returnTo=${encodeURIComponent(returnTo)}`);
  }

  return result;
}

/**
 * Call at the top of every page and data-loading action. Layouts do not re-run on client
 * navigation, so the page itself must prove the Staff member holds its Module.
 */
export async function requireModule(module: string): Promise<Staff> {
  const result = await settle(await (await requestAccess()).check(module));

  if (result.decision === "denied") {
    redirect(NO_ACCESS_PATH);
  }

  return result.staff;
}

/** The Staff member and the pages they may open, for the shell. No Module at all means no access. */
export async function getShell(): Promise<{ staff: Staff; permittedPages: string[] }> {
  const access = await requestAccess();
  const results = await Promise.all(pages.map(async (page) => settle(await access.check(page.module))));
  const allowed = results.flatMap((result, i) =>
    result.decision === "allowed" ? [{ staff: result.staff, href: pages[i].href }] : [],
  );

  if (allowed.length === 0) {
    redirect(NO_ACCESS_PATH);
  }

  return { staff: allowed[0].staff, permittedPages: allowed.map((a) => a.href) };
}

/** The first page the Staff member may open, or the "no access" page when there is none. */
export async function firstPermittedPageOrNoAccess(): Promise<string> {
  const access = await requestAccess();
  const results = await Promise.all(pages.map(async (page) => settle(await access.check(page.module))));
  const index = results.findIndex((result) => result.decision === "allowed");

  return index === -1 ? NO_ACCESS_PATH : pages[index].href;
}
