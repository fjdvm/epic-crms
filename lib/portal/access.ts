import { validateSession, type Staff, type Validation } from "./client";
import { devBypassEnabled, devUser, type DevRole } from "./dev-bypass";
import { auditAccessDenied } from "./access-audit";
import { pages } from "./pages";
import { MANAGEMENT_MODULE } from "./config";
import { canManage } from "./roles";

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
  { bypass = devBypassEnabled(), devRole }: { bypass?: boolean; /** Which dev user the bypass signs in; Staff when not given. */ devRole?: DevRole } = {},
) {
  const answers = new Map<string, Promise<Validation>>();

  function check(module: string): Promise<Validation> {
    if (bypass) {
      return Promise.resolve({ decision: "allowed", staff: devUser(devRole) });
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

    // Management also needs the Manager-level Role, so a Module that reached anyone else opens nothing.
    const allowed = results.flatMap((result, i) =>
      result.decision === "allowed" && (pages[i].module !== MANAGEMENT_MODULE || canManage(result.staff))
        ? [{ staff: result.staff, href: pages[i].href }]
        : [],
    );

    return allowed.length === 0
      ? { decision: "denied" }
      : { decision: "allowed", staff: allowed[0].staff, pages: allowed.map((a) => a.href) };
  }

  /** Only explicit refusals are audited; permission discovery is deliberately silent. */
  async function recordDenial(module: string) {
    if (!bypass && sessionHandle) await auditAccessDenied(sessionHandle, module);
  }

  return { check, checkAny, overview, recordDenial };
}
