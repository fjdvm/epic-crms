// Paths are repository-relative, as emitted by git diff --name-only.
const docsOnly = process.argv.slice(2).every((file) =>
  file.startsWith("docs/") ||
  file.endsWith(".md") ||
  file.startsWith(".claude/") ||
  file.startsWith(".github/ISSUE_TEMPLATE/"),
);
console.log(docsOnly ? "docs-only" : "code");
