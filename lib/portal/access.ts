import { validateSession, type Staff, type Validation } from "./client";
import { DEV_STAFF, devBypassEnabled } from "./dev-bypass";
import { pages } from "./pages";

export type Overview =
  | { decision: "allowed"; staff: Staff; pages: string[] }
  | { decision: "denied" }
  | { decision: "invalid" }
  | { decision: "unavailable" };

/**
 * Access for one page load. The Portal is asked once per Module and the answer is
 * reused for the rest of the load; nothing is remembered beyond it.
 */
export function accessFor(
  sessionHandle: string | undefined,
  { bypass = devBypassEnabled() }: { bypass?: boolean } = {},
) {
  const answers = new Map<string, Promise<Validation>>();

  function check(module: string): Promise<Validation> {
    if (bypass) {
      return Promise.resolve({ decision: "allowed", staff: DEV_STAFF });
    }

    if (!sessionHandle) {
      return Promise.resolve({ decision: "invalid" });
    }

    let answer = answers.get(module);

    if (!answer) {
      answer = validateSession(sessionHandle, module);
      answers.set(module, answer);
    }

    return answer;
  }

  /** Allowed when the Staff member holds at least one of the Modules, as the Order detail page needs. */
  async function checkAny(modules: readonly string[]): Promise<Validation> {
    const results = await Promise.all(modules.map(check));

    // One Module held is enough, so an allowed answer wins over a Module the Portal could not answer.
    return (
      results.find((r) => r.decision === "allowed") ??
      results.find((r) => r.decision === "unavailable") ??
      results.find((r) => r.decision === "invalid") ??
      results[0]
    );
  }

  /** Every page's Module at once: who the Staff member is and which pages they may open. */
  async function overview(): Promise<Overview> {
    const results = await Promise.all(pages.map((page) => check(page.module)));

    for (const blocker of ["unavailable", "invalid"] as const) {
      if (results.some((result) => result.decision === blocker)) {
        return { decision: blocker };
      }
    }

    const allowed = results.flatMap((result, i) =>
      result.decision === "allowed" ? [{ staff: result.staff, href: pages[i].href }] : [],
    );

    return allowed.length === 0
      ? { decision: "denied" }
      : { decision: "allowed", staff: allowed[0].staff, pages: allowed.map((a) => a.href) };
  }

  return { check, checkAny, overview };
}
