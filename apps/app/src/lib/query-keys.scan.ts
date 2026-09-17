import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { queryKeys } from './query-keys';

/**
 * Enumerates every query key in `apps/app/src` **from the source itself**.
 *
 * The gate that failed us before failed because its input was hand-written: a
 * test that lists the keys it expects cannot fail to mention the key that is
 * missing. So nothing here is typed by hand — the definitions, the
 * invalidations and the factory's own roots are all read out of the artifacts.
 *
 * Test-only. Not imported by the app.
 */

/** Cache operations that CONSUME a key someone else must have defined. */
const CACHE_OPS = new Set([
  'invalidateQueries',
  'removeQueries',
  'cancelQueries',
  'refetchQueries',
  'resetQueries',
  'setQueryData',
  'setQueriesData',
  'getQueryData',
  'getQueriesData',
  'ensureQueryData',
  'fetchQuery',
  'prefetchQuery',
]);

/**
 * The factory is the definition of the keys, not a user of them, so scanning it
 * would only ever report itself.
 */
const SELF = ['lib/query-keys.ts', 'lib/query-keys.scan.ts'];

export interface KeySite {
  /** Path relative to `src/`. */
  file: string;
  line: number;
  /** The cache operation, for a usage. `null` for a definition. */
  op: string | null;
  /** Roots this key could resolve to. `null` = the scanner could not resolve it. */
  roots: string[] | null;
  /** Source text of the key expression. */
  text: string;
  /** True when the key is a bare array literal — the thing the ratchet counts. */
  isRawLiteral: boolean;
}

export interface ScanResult {
  /** Keys attached to a `queryFn` — i.e. a query that actually exists. */
  definitions: KeySite[];
  /** Keys handed to a cache operation — i.e. a key someone must have defined. */
  usages: KeySite[];
}

// ---------------------------------------------------------------------------
// The factory's own roots, read off the real object at runtime.
// ---------------------------------------------------------------------------

/** `"organization.members"` → `"organization"`, derived by CALLING the factory. */
function buildFactoryRootMap(): Map<string, string> {
  const map = new Map<string, string>();

  const walk = (node: unknown, prefix: string[]): void => {
    if (typeof node === 'function') {
      // Arity is known; the args only shape the tail, never the root.
      const args = Array.from({ length: node.length }, () => '_');
      const produced = (node as (...a: unknown[]) => unknown[])(...args);
      const root = produced[0];
      if (typeof root === 'string') map.set(prefix.join('.'), root);
      return;
    }
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) walk(v, [...prefix, k]);
    }
  };

  walk(queryKeys, []);
  return map;
}

export const factoryRootMap = buildFactoryRootMap();

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

const unwrap = (node: ts.Node): ts.Node => {
  let n = node;
  while (
    ts.isAsExpression(n) ||
    ts.isParenthesizedExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression(n)
  ) {
    n = n.expression;
  }
  return n;
};

const uniq = (values: string[]): string[] => [...new Set(values)];

class FileScanner {
  private readonly sf: ts.SourceFile;
  /** Every value binding declared in this file, by name. */
  private readonly decls = new Map<string, ts.Node[]>();
  /** Named imports: local name → module specifier. */
  private readonly imports = new Map<string, string>();

  constructor(
    private readonly srcDir: string,
    private readonly file: string,
    text: string,
    private readonly resolveModule: (
      fromFile: string,
      spec: string
    ) => FileScanner | null
  ) {
    this.sf = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );
    this.collectDeclarations(this.sf);
  }

  private collectDeclarations(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      this.push(node.name.text, node);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      this.push(node.name.text, node);
    } else if (ts.isImportDeclaration(node)) {
      const spec = node.moduleSpecifier;
      const clause = node.importClause;
      if (ts.isStringLiteral(spec) && clause?.namedBindings) {
        const bindings = clause.namedBindings;
        if (ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            this.imports.set(el.name.text, spec.text);
          }
        }
      }
    }
    ts.forEachChild(node, (child) => this.collectDeclarations(child));
  }

  private push(name: string, node: ts.Node): void {
    const existing = this.decls.get(name);
    if (existing) existing.push(node);
    else this.decls.set(name, [node]);
  }

  private line(node: ts.Node): number {
    return (
      this.sf.getLineAndCharacterOfPosition(node.getStart(this.sf)).line + 1
    );
  }

  /** Exported/declared value with this name, for cross-file resolution. */
  declarationsOf(name: string): ts.Node[] {
    return this.decls.get(name) ?? [];
  }

  /** Every `[<string>, …]` inside a subtree — the fallback when a precise path lookup fails. */
  private collectArrayRoots(node: ts.Node): string[] {
    const found: string[] = [];
    const visit = (n: ts.Node): void => {
      if (ts.isArrayLiteralExpression(n)) {
        const head = n.elements[0];
        if (head && ts.isStringLiteral(head)) found.push(head.text);
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  }

  /** Leftmost identifier of `a.b.c()` → `a`, and the property path after it. */
  private factoryPath(node: ts.Node): string | null {
    const parts: string[] = [];
    let n: ts.Node = unwrap(node);
    if (ts.isCallExpression(n)) n = unwrap(n.expression);
    while (ts.isPropertyAccessExpression(n)) {
      parts.unshift(n.name.text);
      n = unwrap(n.expression);
    }
    if (!ts.isIdentifier(n)) return null;
    // Must be the imported factory, not a local variable that happens to share
    // its name (`use-integration-oauth-redirect.ts` used to declare one).
    if (this.decls.has(n.text)) return null;
    const spec = this.imports.get(n.text);
    if (!spec || !spec.endsWith('query-keys')) return null;
    return parts.join('.');
  }

  /**
   * All roots a key expression could resolve to, following identifiers,
   * property paths, calls, for-of bindings and single-hop relative imports.
   * `null` when the scanner genuinely cannot tell.
   */
  roots(node: ts.Node, seen = new Set<ts.Node>()): string[] | null {
    if (seen.has(node)) return null;
    seen.add(node);

    const n = unwrap(node);

    const viaFactory = this.factoryPath(n);
    if (viaFactory !== null) {
      const root = factoryRootMap.get(viaFactory);
      return root ? [root] : null;
    }

    if (ts.isArrayLiteralExpression(n)) {
      const head = n.elements[0];
      if (!head) return [];
      if (
        ts.isStringLiteral(head) ||
        ts.isNoSubstitutionTemplateLiteral(head)
      ) {
        return [head.text];
      }
      return this.roots(head, seen);
    }

    if (ts.isStringLiteral(n)) return [n.text];

    if (ts.isCallExpression(n)) return this.roots(n.expression, seen);

    if (
      ts.isArrowFunction(n) ||
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n)
    ) {
      return n.body ? uniq(this.collectArrayRoots(n.body)) : null;
    }

    if (ts.isPropertyAccessExpression(n)) {
      const target = this.resolveValue(n.expression, seen);
      if (!target) return null;
      if (ts.isObjectLiteralExpression(target)) {
        const prop = target.properties.find(
          (p) =>
            p.name && ts.isIdentifier(p.name) && p.name.text === n.name.text
        );
        if (prop && ts.isPropertyAssignment(prop)) {
          return this.roots(prop.initializer, seen);
        }
      }
      // `sessionQueryOptions.queryKey`, `campaignKeys.<unknown>` — take every
      // root the object could yield. A superset is safe for a
      // "was this root ever DEFINED?" check.
      return uniq(this.collectArrayRoots(target));
    }

    if (ts.isIdentifier(n)) {
      const resolved = this.resolveValue(n, seen);
      if (!resolved) return null;
      return this.roots(resolved, seen);
    }

    return null;
  }

  /** An identifier / property path → the node holding its value. */
  private resolveValue(node: ts.Node, seen: Set<ts.Node>): ts.Node | null {
    const n = unwrap(node);

    if (ts.isIdentifier(n)) {
      for (const decl of this.decls.get(n.text) ?? []) {
        if (ts.isFunctionDeclaration(decl)) return decl;
        if (ts.isVariableDeclaration(decl)) {
          if (decl.initializer) return unwrap(decl.initializer);
          // `for (const key of keysToInvalidate)` — the element's value is the
          // iterable's. Without this hop, a whole switch of raw keys hides
          // behind one loop variable (this is how `['calendar-accounts']`
          // survived).
          const forOf = decl.parent?.parent;
          if (forOf && ts.isForOfStatement(forOf)) {
            return (
              this.resolveValue(forOf.expression, seen) ?? forOf.expression
            );
          }
        }
      }

      const spec = this.imports.get(n.text);
      if (spec) {
        const mod = this.resolveModule(this.file, spec);
        if (mod && mod !== this) {
          for (const decl of mod.declarationsOf(n.text)) {
            if (ts.isFunctionDeclaration(decl)) return decl;
            if (ts.isVariableDeclaration(decl) && decl.initializer) {
              // Roots resolve in the DEFINING file's scope.
              const imported = mod.roots(decl.initializer, seen);
              if (imported) {
                // Smuggle the answer back as a synthetic array literal.
                return ts.factory.createArrayLiteralExpression(
                  imported.map((r) => ts.factory.createStringLiteral(r))
                );
              }
            }
          }
        }
        return null;
      }
      return null;
    }

    if (ts.isPropertyAccessExpression(n)) {
      const base = this.resolveValue(n.expression, seen);
      if (base && ts.isObjectLiteralExpression(base)) {
        const prop = base.properties.find(
          (p) =>
            p.name && ts.isIdentifier(p.name) && p.name.text === n.name.text
        );
        if (prop && ts.isPropertyAssignment(prop))
          return unwrap(prop.initializer);
      }
      return base;
    }

    if (ts.isCallExpression(n)) return this.resolveValue(n.expression, seen);

    return n;
  }

  /** Every `queryKey:` site in this file, classified. */
  sites(): ScanResult {
    const definitions: KeySite[] = [];
    const usages: KeySite[] = [];
    const rel = path.relative(this.srcDir, this.file);

    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'queryKey'
      ) {
        const obj = node.parent;
        const isDefinition =
          ts.isObjectLiteralExpression(obj) &&
          obj.properties.some(
            (p) =>
              p.name && ts.isIdentifier(p.name) && p.name.text === 'queryFn'
          );

        let call: ts.Node | undefined = obj.parent;
        while (call && !ts.isCallExpression(call)) call = call.parent;
        const op =
          call &&
          ts.isCallExpression(call) &&
          ts.isPropertyAccessExpression(call.expression)
            ? call.expression.name.text
            : null;

        const site: KeySite = {
          file: rel,
          line: this.line(node),
          op: isDefinition ? null : op,
          roots: this.roots(node.initializer),
          text: node.initializer.getText(this.sf).replace(/\s+/g, ' '),
          isRawLiteral: ts.isArrayLiteralExpression(unwrap(node.initializer)),
        };

        if (isDefinition) definitions.push(site);
        else if (op && CACHE_OPS.has(op)) usages.push(site);
        // A `queryKey` on neither a queryFn nor a cache op (e.g. spread into a
        // shared options object) is neither a definition nor a usage.
      }
      ts.forEachChild(node, visit);
    };

    visit(this.sf);
    return { definitions, usages };
  }
}

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
        out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

export function scanQueryKeys(srcDir: string): ScanResult {
  const cache = new Map<string, FileScanner | null>();

  const load = (file: string): FileScanner | null => {
    const cached = cache.get(file);
    if (cached !== undefined) return cached;
    let scanner: FileScanner | null = null;
    if (fs.existsSync(file)) {
      scanner = new FileScanner(
        srcDir,
        file,
        fs.readFileSync(file, 'utf8'),
        resolveModule
      );
    }
    cache.set(file, scanner);
    return scanner;
  };

  const resolveModule = (
    fromFile: string,
    spec: string
  ): FileScanner | null => {
    let base: string;
    if (spec.startsWith('@/')) base = path.join(srcDir, spec.slice(2));
    else if (spec.startsWith('.'))
      base = path.resolve(path.dirname(fromFile), spec);
    else return null; // node_modules — not ours to scan.

    for (const candidate of [
      `${base}.ts`,
      `${base}.tsx`,
      path.join(base, 'index.ts'),
      path.join(base, 'index.tsx'),
    ]) {
      if (fs.existsSync(candidate)) return load(candidate);
    }
    return null;
  };

  const definitions: KeySite[] = [];
  const usages: KeySite[] = [];

  for (const file of listSourceFiles(srcDir)) {
    const rel = path.relative(srcDir, file);
    if (SELF.includes(rel)) continue;

    const text = fs.readFileSync(file, 'utf8');
    if (!text.includes('queryKey')) continue;

    const scanner = load(file);
    if (!scanner) continue;

    const result = scanner.sites();
    definitions.push(...result.definitions);
    usages.push(...result.usages);
  }

  return { definitions, usages };
}
