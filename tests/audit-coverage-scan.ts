import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

/** Static scan behind tests/audit-coverage.test.ts: finds write units and whether they reach the audit boundary. */
export const root = path.resolve(import.meta.dirname, "..");

type Fn = { file: string; name: string; node: ts.Node };
type Parsed = { fns: Map<string, Fn>; imports: Map<string, { file: string; name: string }>; exported: string[]; useServer: boolean };

const cache = new Map<string, Parsed | null>();
/** Names of the audit boundary and its helpers. Types and actor builders alone are not evidence of a recorded event. */
const AUDIT = /audit/i;
const NOT_EVIDENCE = new Set(["AuditTrail", "AuditEvent", "staffAuditActor", "Audit", "audited", "Audited"]);
/** Access guards (requireModule and friends) audit refusals for every action, so reaching them says nothing about this action. */
const GUARD_DIRS = ["lib/portal/"];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(path.join(root, dir), { withFileTypes: true })) {
    const rel = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? path.posix.join(path.posix.dirname(from), spec) : null;
  if (!base) return null;
  for (const c of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) if (existsSync(path.join(root, c))) return c;
  return null;
}

function parse(file: string): Parsed | null {
  if (cache.has(file)) return cache.get(file)!;
  let result: Parsed | null = null;
  if (existsSync(path.join(root, file))) {
    const src = readFileSync(path.join(root, file), "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const fns = new Map<string, Fn>(); const imports = new Map<string, { file: string; name: string }>(); const exported: string[] = [];
    const first = sf.statements[0];
    const useServer = !!first && ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === "use server";
    for (const n of sf.statements) {
      const isExport = ts.canHaveModifiers(n) && !!ts.getModifiers(n)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause?.namedBindings && ts.isNamedImports(n.importClause.namedBindings)) {
        const target = resolveImport(file, n.moduleSpecifier.text);
        if (target) for (const el of n.importClause.namedBindings.elements) imports.set(el.name.text, { file: target, name: (el.propertyName ?? el.name).text });
      }
      if (ts.isFunctionDeclaration(n) && n.name) { fns.set(n.name.text, { file, name: n.name.text, node: n }); if (isExport) exported.push(n.name.text); }
      if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) { fns.set(d.name.text, { file, name: d.name.text, node: d.initializer }); if (isExport) exported.push(d.name.text); }
    }
    result = { fns, imports, exported, useServer };
  }
  cache.set(file, result);
  return result;
}

function identifiers(node: ts.Node, out: string[] = []): string[] {
  if (ts.isIdentifier(node)) out.push(node.text);
  ts.forEachChild(node, (c) => { identifiers(c, out); });
  return out;
}

/** True when the function, or a function it reaches through imports or the same file (up to `depth` hops), names the audit boundary. */
export function reachesAudit(file: string, name: string, depth = 5, seen = new Set<string>()): boolean {
  const key = `${file}#${name}`;
  if (seen.has(key) || depth < 0 || GUARD_DIRS.some((d) => file.startsWith(d))) return false;
  seen.add(key);
  const parsed = parse(file); const fn = parsed?.fns.get(name);
  if (!parsed || !fn) return false;
  const ids = identifiers(fn.node);
  if (ids.some((i) => AUDIT.test(i) && !NOT_EVIDENCE.has(i))) return true;
  for (const id of new Set(ids)) {
    if (id === name) continue;
    const imp = parsed.imports.get(id);
    if (imp ? reachesAudit(imp.file, imp.name, depth - 1, seen) : parsed.fns.has(id) && reachesAudit(file, id, depth - 1, seen)) return true;
  }
  return false;
}

export interface WriteUnit { id: string; audited: boolean }

const ROUTE_WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Cron routes answer GET but do work, so they count as writes. */
const isCron = (file: string) => file.startsWith("app/api/cron/");

export function writeUnits(): WriteUnit[] {
  const units: WriteUnit[] = [];
  for (const file of [...walk("features"), ...walk("lib"), ...walk("app"), ...walk("components"), ...walk("hooks")].sort()) {
    const isRoute = /^app\/api\/.*\/route\.ts$/.test(file);
    const parsed = parse(file);
    if (!parsed) continue;
    if (isRoute) {
      for (const name of parsed.exported) if (ROUTE_WRITE.has(name) || (name === "GET" && isCron(file))) units.push({ id: `${file}#${name}`, audited: reachesAudit(file, name) });
    } else if (parsed.useServer) {
      for (const name of parsed.exported) if (parsed.fns.get(name) && ts.isFunctionLike(parsed.fns.get(name)!.node)) units.push({ id: `${file}#${name}`, audited: reachesAudit(file, name) });
    }
  }
  return units;
}
