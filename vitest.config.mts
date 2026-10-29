import path from "node:path";

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, ".") },
  },
  // Nested worktrees under .claude/ hold their own copies of the tests and share this database.
  test: { exclude: [...configDefaults.exclude, ".claude/**"] },
});
