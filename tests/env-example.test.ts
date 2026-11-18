import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const roots = ["app", "lib", "features", "components", "hooks", "proxy.ts", "instrumentation.ts"];
// Set by the platform or the test harness, not by an operator.
const provided = new Set(["NODE_ENV", "NEXT_RUNTIME", "CREOMS_TEST_DATABASE_URL", "PORT", "HOSTNAME"]);

function sources(target: string): string[] {
  const full = path.join(root, target);
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(path.join(target, entry.name)) : /\.(ts|tsx)$/.test(entry.name) ? [path.join(full, entry.name)] : []);
}

describe(".env.example", () => {
  it("lists every environment key the app reads", () => {
    const example = readFileSync(path.join(root, ".env.example"), "utf8");
    const used = new Set(roots.flatMap(sources).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/(?:process\.env|env)\.([A-Z][A-Z0-9_]+)/g)].map((match) => match[1])));
    const missing = [...used].filter((key) => !provided.has(key) && !new RegExp(`^#?\\s*${key}=`, "m").test(example));

    expect(missing).toEqual([]);
  });
});
