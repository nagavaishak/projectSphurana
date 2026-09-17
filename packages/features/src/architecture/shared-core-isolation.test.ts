import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE TEST — "shared/core is a dependency-clean, extractable leaf".
 *
 * `packages/features/src/shared/core/` is the stable primitive core of the
 * features shared layer (Result/FeatureError/ErrorCodes, DbConnection + base
 * types, branded ids, soft-delete/audit primitives, org-context plumbing). It is
 * being prepared for extraction into its own leaf package
 * (`@borradh-workspace/features-shared-core`).
 *
 * For that extraction to stay possible, `core/` must depend on NOTHING
 * domain-flavored. Concretely, every file under `core/` may import ONLY:
 *
 *   1. other files WITHIN `core/`                         (relative, no `../` escape)
 *   2. external npm packages / node builtins              (zod, drizzle-orm, node:*)
 *   3. a small allowlist of LEAF workspace packages       (database, labels, observability)
 *
 * It must NEVER import:
 *   - a domain-flavored sibling in `shared/` (currency-for-country, loops,
 *     notion-crm, build-meta-targeting, flfb flags, sample-assets, …) — caught
 *     as a relative import that resolves OUTSIDE `core/`, OR
 *   - any feature domain (`@borradh-workspace/features/*`, or a relative path
 *     into `packages/features/src/<domain>/`).
 *
 * This test statically scans `core/` and fails on any disallowed import, which
 * is what keeps the core extractable.
 */

const CORE_DIR = path.resolve(__dirname, '../shared/core');
const REPO_ROOT = path.resolve(__dirname, '../../../../');

/**
 * Leaf workspace packages `core/` is allowed to depend on. These are themselves
 * extractable leaves (no feature-domain code), so importing them keeps `core/`
 * a leaf. Anything else under `@borradh-workspace/*` is a violation.
 */
const ALLOWED_WORKSPACE_PACKAGES: ReadonlySet<string> = new Set([
  '@borradh-workspace/database',
  '@borradh-workspace/labels',
  '@borradh-workspace/observability',
]);

/** Match `from '...'`, `import '...'`, and `export ... from '...'` specifiers. */
const IMPORT_RE =
  /(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g;

function collectCoreFiles(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectCoreFiles(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      acc.push(full);
    }
  }
}

function extractSpecifiers(content: string): string[] {
  const specs: string[] = [];
  IMPORT_RE.lastIndex = 0;
  let m: RegExpExecArray | null = IMPORT_RE.exec(content);
  while (m !== null) {
    specs.push(m[1] ?? m[2]);
    m = IMPORT_RE.exec(content);
  }
  return specs;
}

/**
 * Classify a single import specifier from a core file. Returns a violation
 * reason string, or null when the import is allowed.
 */
function violationFor(fromFile: string, spec: string): string | null {
  // Relative import: must resolve to a path still inside CORE_DIR.
  if (spec.startsWith('.')) {
    const resolved = path.resolve(path.dirname(fromFile), spec);
    const rel = path.relative(CORE_DIR, resolved);
    const escapesCore = rel.startsWith('..') || path.isAbsolute(rel);
    if (escapesCore) {
      return `relative import escapes shared/core/ (points at a domain-flavored / non-core module): '${spec}'`;
    }
    return null;
  }

  // Workspace package import.
  if (spec.startsWith('@borradh-workspace/')) {
    // Feature domains are hard-forbidden.
    if (spec.startsWith('@borradh-workspace/features')) {
      return `imports a feature domain: '${spec}'`;
    }
    const pkg = spec.split('/').slice(0, 2).join('/');
    if (!ALLOWED_WORKSPACE_PACKAGES.has(pkg)) {
      return `imports a non-leaf/unapproved workspace package: '${spec}' (allowed: ${[...ALLOWED_WORKSPACE_PACKAGES].join(', ')})`;
    }
    return null;
  }

  // Bare specifier = external npm package or node builtin — always allowed.
  return null;
}

describe('architecture: shared/core is a dependency-clean extractable leaf', () => {
  const files: string[] = [];
  collectCoreFiles(CORE_DIR, files);

  it('scans at least the known core modules', () => {
    // Guard against the glob silently matching nothing (which would make the
    // isolation assertion vacuously pass).
    expect(files.length).toBeGreaterThanOrEqual(6);
  });

  it('has no core file importing a domain-flavored module or a feature domain', () => {
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const relFile = path.relative(REPO_ROOT, file).replaceAll(path.sep, '/');
      for (const spec of extractSpecifiers(content)) {
        const reason = violationFor(file, spec);
        if (reason) violations.push(`${relFile} — ${reason}`);
      }
    }

    expect(
      violations.sort(),
      `shared/core/ must stay a dependency-clean leaf (importing only itself,\nexternal npm, and leaf workspace packages) so it can be extracted as\n@borradh-workspace/features-shared-core. Offenders:\n  ${violations.sort().join('\n  ')}`
    ).toEqual([]);
  });
});
