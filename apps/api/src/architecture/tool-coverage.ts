import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  type AreaCoverage,
  type CoverageEntry,
  isExposed,
  isNotExposed,
  isUndecided,
} from '../assistant/tools/coverage.types.js';
import {
  ALL_VERBS,
  type MutatingEndpoint,
  collectMutatingEndpoints,
} from './api-surface.js';

export const REPO_ROOT = path.join(__dirname, '../../../..');
const API_SRC = path.join(REPO_ROOT, 'apps/api/src');
const TOOLS_DIR = path.join(API_SRC, 'assistant/tools');

/**
 * Canonical tool names, read STATICALLY from `*.tool.ts` sources.
 *
 * Deliberately not `require`d from the registry. Importing it pulls every tool
 * module, and each handler reaches into feature services that validate env at
 * import time — `tool-registry.spec.ts` needs six env placeholders and four
 * `jest.mock`s to survive that. A gate that needs a stub graveyard to run is a
 * gate people delete. `defineTool` builds the name as
 * `feature.replace(/-/g,'_') + '_' + action` (`define-tool.ts:247`), and all
 * 129 tool files carry both keys as string literals, so a scan is exact.
 */
export function collectToolNames(): { names: Set<string>; unparsed: string[] } {
  const names = new Set<string>();
  const unparsed: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (entry.endsWith('.tool.ts')) {
        const src = readFileSync(full, 'utf8');
        const feature = /^\s*feature:\s*'([^']+)'/m.exec(src)?.[1];
        const action = /^\s*action:\s*'([^']+)'/m.exec(src)?.[1];
        if (!feature || !action) {
          // A tool whose descriptor cannot be read is a name the gate cannot
          // verify — fail loudly rather than silently accept every `exposed`.
          unparsed.push(
            path.relative(REPO_ROOT, full).replaceAll(path.sep, '/')
          );
          continue;
        }
        names.add(`${feature.replaceAll('-', '_')}_${action}`);
      }
    }
  };
  walk(TOOLS_DIR);
  return { names, unparsed };
}

/** Load every `apps/api/src/assistant/tools/<area>/coverage.ts`. */
export function collectCoverageFiles(): AreaCoverage[] {
  const out: AreaCoverage[] = [];
  for (const entry of readdirSync(TOOLS_DIR)) {
    const file = path.join(TOOLS_DIR, entry, 'coverage.ts');
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    // Safe to require: `coverage.ts` files import only `coverage.types.ts`,
    // which imports nothing. No env, no db, no feature barrel.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(file) as Record<string, unknown>;
    for (const value of Object.values(mod)) {
      if (
        value &&
        typeof value === 'object' &&
        'area' in value &&
        'entries' in value
      ) {
        out.push(value as AreaCoverage);
      }
    }
  }
  return out;
}

export interface CoverageDefect {
  kind:
    | 'undeclared'
    | 'stale'
    | 'unknown-tool'
    | 'weak-reason'
    | 'missing-confirm'
    | 'confirm-on-read'
    | 'duplicate';
  detail: string;
}

export interface CoverageReport {
  /** Every endpoint on every verb. */
  endpoints: MutatingEndpoint[];
  /** Endpoints in an area that has a `coverage.ts`. */
  graded: MutatingEndpoint[];
  /** Route prefixes with a coverage file, e.g. `shifts`. */
  coveredAreas: string[];
  defects: CoverageDefect[];
  /** Endpoint ids currently parked as `undecided`. Ratchets down. */
  undecided: string[];
  exposedCount: number;
  notExposedCount: number;
  surfaceUnparsed: string[];
  toolsUnparsed: string[];
}

/** First path segment of a route: `/shifts/weekly/:x` -> `shifts`. */
export const areaOf = (route: string): string =>
  route.replace(/^\//, '').split('/')[0] ?? '';

const MIN_REASON = 25;

export function buildToolCoverageReport(): CoverageReport {
  const surface = collectMutatingEndpoints(API_SRC, REPO_ROOT, ALL_VERBS);
  const { names: toolNames, unparsed: toolsUnparsed } = collectToolNames();
  const files = collectCoverageFiles();

  const coveredAreas = files.map((f) => f.area).sort();
  const defects: CoverageDefect[] = [];

  // One endpoint may be declared once, by exactly one area file.
  const declaredBy = new Map<string, string>();
  const declarations = new Map<string, CoverageEntry>();
  for (const file of files) {
    for (const [id, entry] of Object.entries(file.entries)) {
      const prior = declaredBy.get(id);
      if (prior) {
        defects.push({
          kind: 'duplicate',
          detail: `"${id}" is declared by both ${prior} and ${file.area}. One endpoint, one owner.`,
        });
        continue;
      }
      declaredBy.set(id, file.area);
      declarations.set(id, entry);
    }
  }

  const byId = new Map(surface.endpoints.map((e) => [e.id, e]));
  const graded = surface.endpoints.filter((e) =>
    coveredAreas.includes(areaOf(e.route))
  );

  // Every endpoint in a covered area must be declared. This is the rule that
  // makes adding a route to an already-covered area fail.
  for (const e of graded) {
    if (!declarations.has(e.id)) {
      defects.push({
        kind: 'undeclared',
        detail: `"${e.id}" (${e.file}) is in covered area "${areaOf(e.route)}" but has no entry in its coverage.ts.`,
      });
    }
  }

  const undecided: string[] = [];
  let exposedCount = 0;
  let notExposedCount = 0;

  for (const [id, entry] of declarations) {
    const endpoint = byId.get(id);
    if (!endpoint) {
      defects.push({
        kind: 'stale',
        detail: `"${id}" is declared in ${declaredBy.get(id)}/coverage.ts but no such endpoint exists. Deleted or renamed — remove the entry.`,
      });
      continue;
    }
    const isRead = endpoint.verb === 'GET';

    if (isExposed(entry)) {
      exposedCount++;
      if (!toolNames.has(entry.exposed)) {
        defects.push({
          kind: 'unknown-tool',
          detail: `"${id}" claims tool "${entry.exposed}", which resolves to no tool file. An exposed: naming a renamed or deleted tool is a lie the gate exists to catch.`,
        });
      }
      if (!isRead && entry.confirm === undefined) {
        defects.push({
          kind: 'missing-confirm',
          detail: `"${id}" is a WRITE exposed as "${entry.exposed}" but does not declare confirm. Whether an owner is asked before this runs must not be decided by omission — set confirm: true or false.`,
        });
      }
      if (isRead && entry.confirm !== undefined) {
        defects.push({
          kind: 'confirm-on-read',
          detail: `"${id}" is a GET and declares confirm. Reads are not confirmed; drop the field.`,
        });
      }
    } else if (isNotExposed(entry)) {
      notExposedCount++;
      if (entry.notExposed.trim().length < MIN_REASON) {
        defects.push({
          kind: 'weak-reason',
          detail: `"${id}" has a notExposed reason under ${MIN_REASON} characters. Write why a human would agree, not a shrug.`,
        });
      }
    } else if (isUndecided(entry)) {
      undecided.push(id);
      if (entry.undecided.trim().length === 0) {
        defects.push({
          kind: 'weak-reason',
          detail: `"${id}" is undecided with no tracking reference. The backlog needs an owner.`,
        });
      }
    }
  }

  return {
    endpoints: surface.endpoints,
    graded,
    coveredAreas,
    defects,
    undecided: undecided.sort(),
    exposedCount,
    notExposedCount,
    surfaceUnparsed: surface.unparsed,
    toolsUnparsed,
  };
}
