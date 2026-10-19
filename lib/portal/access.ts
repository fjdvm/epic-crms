import { validateSession, type Validation } from "./client";
import { pages } from "./pages";

/**
 * Access for one page load. The Portal is asked once per Module and the answer is
 * reused for the rest of the load; nothing is remembered beyond it.
 */
export function accessFor(sessionHandle: string | undefined) {
  const answers = new Map<string, Promise<Validation>>();

  function check(module: string): Promise<Validation> {
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

  async function permittedPages(): Promise<string[]> {
    const results = await Promise.all(pages.map((page) => check(page.module)));

    return pages.filter((_, i) => results[i].decision === "allowed").map((page) => page.href);
  }

  return {
    check,
    permittedPages,
    async firstPermittedPage(): Promise<string | null> {
      return (await permittedPages())[0] ?? null;
    },
  };
}
