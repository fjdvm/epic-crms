import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const script = path.join(import.meta.dirname, "classify-changes.mjs");

function classify(paths: string[]) {
  return spawnSync(process.execPath, [script, ...paths], { encoding: "utf8" });
}

describe("classify-changes.mjs", () => {
  it.each([
    "docs/design/screen.png",
    "docs/nested/config.json",
    "README.md",
    "GLOSSARY.md",
    "AGENTS.md",
    "CLAUDE.md",
    "app/admin/README.md",
    "scripts/usage.md",
    ".claude/skills/example/agents/openai.yaml",
    ".github/ISSUE_TEMPLATE/bug.yml",
  ])("classifies %s as docs-only", (file) => {
    const result = classify([file]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("docs-only\n");
  });
  it.each([
    "package.json",
    "package-lock.json",
    "Dockerfile",
    "scripts/deploy/render-container-app.py",
    "scripts/ci/classify-changes.mjs",
    "app/page.tsx",
    ".github/workflows/container.yml",
    "next.config.ts",
    "docs-old/config.json",
    ".claude-old/config.json",
    ".github/ISSUE_TEMPLATE-old/bug.yml",
    "app/docs/config.json",
    "README.md.ts",
    "docs with spaces/code.ts",
  ])("classifies %s as code", (file) => {
    const result = classify([file]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("code\n");
  });

  it("classifies a mixed change as code regardless of path order", () => {
    for (const files of [
      ["README.md", "app/page.tsx"],
      ["app/page.tsx", "README.md"],
    ]) {
      const result = classify(files);

      expect(result.status).toBe(0);
      expect(result.stdout).toBe("code\n");
    }
  });

  it("classifies multiple documentation paths as docs-only", () => {
    const result = classify(["README.md", "docs/a file.png", ".claude/config.json"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("docs-only\n");
  });

  it("classifies an empty change as docs-only", () => {
    const result = classify([]);

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("docs-only\n");
  });
});
