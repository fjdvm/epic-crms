import path from "node:path";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
  // Nested worktrees under .claude/ hold their own copies of the tests and share this database.
  // Each database test starts its own in-memory Postgres; under a full parallel run that can take over the 10s default.
  test: { exclude: [...configDefaults.exclude, ".claude/**"], hookTimeout: 60_000 },
});
