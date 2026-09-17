import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './endpoint-coverage.js';

/**
 * Static enumeration of ENTRY POINTS and whether each declares a policy.
 *
 * This is the input to Gate 3 in `docs/engineering/capability-architecture.md`.
 *
 * An entry point is anywhere a request ENTERS the system and something must
 * decide whether the caller may do this. There are three kinds:
 *
 *   1. **controller route** — declares policy via the guards in scope
 *      (`@UseGuards(...)` on the class and/or the method).
 *   2. **claire tool** — declares policy via `ToolDefinition.policy`.
 *   3. **worker job** — see the note at the bottom; NOT scanned yet, and that
 *      is recorded rather than silently omitted.
 *
 * WHY THE DOC SAYS THIS MUST EXIST FIRST
 * --------------------------------------
 * `@RequireRole('admin')` on a route is declarative and greppable, which is
 * the property that makes guards good. Moving policy into use cases loses it.
 * So the rule is: this gate must exist BEFORE any policy moves out of a Nest
 * guard, so that the move is a measurable transfer rather than a silent hole.
 *
 * MEASURED, NOT ASSUMED
 * ---------------------
 * The doc claims "the real gap today is that tools and workers declare
 * nothing". For tools that is exactly right: `ToolDefinition` carried
 * `destructive` (a human-in-the-loop CONFIRMATION gate) and `hardBlocks`
 * (content validators), and nothing at all about WHO may call. `policy` was
 * added for this gate.
 *
 * For controllers the claim needs qualifying: 73 of 97 controllers carry
 * `@UseGuards(AuthGuard)`. The remainder are mostly deliberately public
 * (webhooks, public booking, health) — which is a policy, but an UNDECLARED
 * one, since "no guard" and "deliberately open" look identical to a scanner.
 * That is what this gate makes visible.
 *
 * Deliberately static (regex over source), like `api-surface.ts`: the gate
 * must run in a plain unit-test process with no DB, no env and no DI graph.
 */

export const API_SRC = path.join(REPO_ROOT, 'apps/api/src');
export const TOOLS_SRC = path.join(REPO_ROOT, 'apps/api/src/assistant/tools');

export type EntryPointKind = 'controller-route' | 'claire-tool';

export interface EntryPoint {
  /** Stable identity. `VERB /route` for a route, `feature_action` for a tool. */
  id: string;
  kind: EntryPointKind;
  /** Repo-relative file. */
  file: string;
  /** The policy it declares, or null when it declares none. */
  policy: string | null;
}

const VERB_RE =
  /^\s*@(Get|Post|Put|Patch|Delete)\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)\s*$/;
const CONTROLLER_RE = /^@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/;
const USE_GUARDS_RE = /@UseGuards\(([^)]*)\)/;
const REQUIRE_ROLE_RE = /@RequireRole\(\s*'([^']*)'/;
const REQUIRE_PERMISSION_RE = /@RequirePermission\(/;
const PUBLIC_RE = /@(Public|SkipAuth|SkipMemberCheck)\(/;

function walk(dir: string, suffix: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, suffix, acc);
    else if (entry.endsWith(suffix)) acc.push(full);
  }
}

function joinRoute(base: string, sub: string): string {
  const b = base.replace(/^\/|\/$/g, '');
  const s = sub.replace(/^\/|\/$/g, '');
  if (!b && !s) return '/';
  if (!s) return `/${b}`;
  if (!b) return `/${s}`;
  return `/${b}/${s}`;
}

/**
 * Controller routes and the policy each declares.
 *
 * "Declares a policy" means: an auth-bearing guard is in scope (class or
 * method `@UseGuards`), or the route is explicitly marked public. A route with
 * neither declares nothing — the scanner cannot tell "open on purpose" from
 * "nobody thought about it", which is precisely the condition worth failing on.
 */
export function collectControllerRoutes(): EntryPoint[] {
  const files: string[] = [];
  walk(API_SRC, '.controller.ts', files);
  files.sort();

  const found: EntryPoint[] = [];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    const lines = readFileSync(file, 'utf8').split('\n');

    let base = '';
    let classGuards = '';
    let classPublic = false;
    // Class-level decorators appear before the `export class` line.
    for (const line of lines) {
      const c = CONTROLLER_RE.exec(line);
      if (c) base = c[1] ?? c[2] ?? '';
      if (/^export class /.test(line)) break;
      const g = USE_GUARDS_RE.exec(line);
      if (g) classGuards = g[1].trim();
      if (PUBLIC_RE.test(line)) classPublic = true;
    }

    // Method-level: accumulate the WHOLE decorator block, then evaluate it when
    // the member signature closes it.
    //
    // NOT when the verb decorator is seen. Decorators are unordered to Nest, and
    // this repo's dominant style puts the verb FIRST:
    //
    //     @Post()
    //     @RequireRole('admin')
    //     async create(...)
    //
    // Closing the block on the verb attributes every decorator written BELOW it
    // to the NEXT route — so `@RequireRole('admin')` on `POST /meta-ads` was
    // credited to the route after it, and the guarded route itself read as
    // undeclared. That is a false negative AND a false positive from one bug,
    // and it survived the first baseline because most controllers carry a
    // class-level `AuthGuard` that masks it.
    let block: string[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (
        trimmed.startsWith('@') ||
        trimmed === '' ||
        trimmed.startsWith('*') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('//')
      ) {
        block.push(line);
        continue;
      }

      const verbLine = block.find((l) => VERB_RE.test(l));
      if (verbLine) {
        const v = VERB_RE.exec(verbLine);
        if (v) {
          const guardLine = block.find((l) => USE_GUARDS_RE.test(l));
          const roleLine = block.find((l) => REQUIRE_ROLE_RE.test(l));
          const methodGuards = guardLine
            ? (USE_GUARDS_RE.exec(guardLine)?.[1].trim() ?? '')
            : '';
          const methodRole = roleLine
            ? `RequireRole('${REQUIRE_ROLE_RE.exec(roleLine)?.[1]}')`
            : block.some((l) => REQUIRE_PERMISSION_RE.test(l))
              ? 'RequirePermission'
              : '';
          const isPublic = block.some((l) => PUBLIC_RE.test(l)) || classPublic;
          const parts = [methodGuards || classGuards, methodRole].filter(
            Boolean
          );

          found.push({
            id: `${v[1].toUpperCase()} ${joinRoute(base, v[2] ?? v[3] ?? '')}`,
            kind: 'controller-route',
            file: rel,
            policy:
              parts.length > 0 ? parts.join(' + ') : isPublic ? 'public' : null,
          });
        }
      }
      block = [];
    }
  }
  return found;
}

/**
 * Claire tools and the policy each declares.
 *
 * Read statically from the source rather than by importing the registry: the
 * registry pulls in the database barrel and the whole tool graph, which a
 * plain architecture test must not need.
 */
export function collectToolEntryPoints(): EntryPoint[] {
  const files: string[] = [];
  walk(TOOLS_SRC, '.tool.ts', files);
  files.sort();

  const found: EntryPoint[] = [];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file);
    const src = readFileSync(file, 'utf8');
    const feature = /\bfeature:\s*'([^']+)'/.exec(src)?.[1];
    const action = /\baction:\s*'([^']+)'/.exec(src)?.[1];
    if (!feature || !action) continue;
    const policy = /\bpolicy:\s*'([^']+)'/.exec(src)?.[1] ?? null;
    found.push({
      id: `${feature}_${action}`,
      kind: 'claire-tool',
      file: rel,
      policy,
    });
  }
  return found;
}

export function collectEntryPoints(): EntryPoint[] {
  return [...collectControllerRoutes(), ...collectToolEntryPoints()];
}

/*
 * WORKER JOBS — deliberately NOT scanned, recorded rather than omitted.
 *
 * `packages/features/src/jobs/` declares a job spine (`define-job.ts`) with a
 * registry gate of its own (`job-registry.test.ts`), but only TWO job
 * definitions exist so far, so the spine does not yet enumerate the worker
 * surface. Scanning it today would produce a gate that passes because it can
 * barely see anything — worse than an acknowledged gap.
 *
 * The policy question for a job is also genuinely different: a job has no
 * caller to authorize, it runs with acts-as credentials (see `internalAuth` in
 * `tool-factory/api-fetch.ts`). What needs a policy is whoever ENQUEUES it,
 * which is already a controller route or a tool — both of which this gate does
 * cover. Whether that reasoning survives contact with more jobs is an open
 * question, and it is written here so the next person can overturn it.
 */
