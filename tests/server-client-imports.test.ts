import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A server component cannot call a function (or read a constant) exported from a "use client" file: Next.js turns it
 * into a client reference and the page throws at render, which unit tests never see. Server pages and layouts may
 * import only components (capitalised names) and types from client files. AI insights broke this way once (#791).
 */
const ROOT = process.cwd();

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]));
}
function resolve(spec: string, from: string): string | null {
  const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? join(from, "..", spec) : null;
  if (!base) return null;
  return [".tsx", ".ts", "/index.tsx", "/index.ts"].map((ext) => base + ext).find(existsSync) ?? null;
}
const isClient = (file: string) => /^\s*["']use client["']/.test(readFileSync(file, "utf8"));

describe("server pages and layouts", () => {
  it("import only components and types from \"use client\" files", () => {
    const servers = files(join(ROOT, "app")).filter((f) => /\/(page|layout|loading|not-found)\.tsx$/.test(f) && !isClient(f));
    const problems: string[] = [];
    for (const file of servers) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/^import\s+(?!type\b)\{([^}]*)\}\s+from\s+["']([^"']+)["']/gm)) {
        const target = resolve(m[2], file);
        if (!target || !isClient(target)) continue;
        const names = m[1].split(",").map((n) => n.trim()).filter((n) => n && !n.startsWith("type "));
        for (const name of names) {
          const local = name.split(/\s+as\s+/)[0];
          if (!/^[A-Z]/.test(local)) problems.push(`${file.slice(ROOT.length + 1)} imports ${local} from ${m[2]}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});
