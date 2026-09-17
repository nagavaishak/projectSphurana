import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Static enumeration of the API's MUTATING surface — every `@Post` / `@Put` /
 * `@Patch` / `@Delete` handler in `apps/api/src/**​/*.controller.ts`.
 *
 * This is the input to Gate 1 (coverage) in
 * `docs/engineering/ports-as-capability-contracts.md`. Types can prove a port
 * is implemented; only an enumeration of the real surface can prove a
 * capability is not *missing entirely* — e.g. `shifts` has 3 write endpoints
 * and 0 tools, and shifts are the sole availability source, so Claire
 * structurally cannot fix a service nobody can book.
 *
 * Deliberately static (regex over source) rather than booting Nest: the gate
 * must run in a plain unit-test process with no DB, no env and no DI graph.
 */

export type HttpVerb = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface MutatingEndpoint {
  /**
   * Stable identity used by the coverage manifest: `VERB /route`.
   *
   * When two handlers share a route (they exist — `POST
   * /integrations/meta-ads/pages` is both a create and a POST-as-query), EVERY
   * colliding entry gets a `#handlerName` suffix so ids stay unique and
   * deterministic.
   */
  id: string;
  verb: HttpVerb;
  /** Full path: `@Controller` base joined with the method decorator's path. */
  route: string;
  /** Repo-relative controller path. */
  file: string;
  /** Handler method name. */
  handler: string;
}

/**
 * The MUTATING verbs. `collectMutatingEndpoints` defaults to these, which is
 * what Gate 1 has always graded.
 */
export const MUTATING_VERBS = ['Post', 'Put', 'Patch', 'Delete'] as const;

/**
 * Every verb, reads included. Gate 6 (`tool-coverage`) grades this set.
 *
 * Reads were invisible to every gate until that one existed, which meant the
 * entire "Claire cannot SEE x" class was unmeasured while her tools were
 * demonstrably read-heavy. A missing read is a harder dead end than a missing
 * write — she cannot reschedule an appointment she cannot find — so the two
 * are graded together, with opposite DEFAULTS. See `tool-coverage.ts`.
 */
export const ALL_VERBS = ['Get', 'Post', 'Put', 'Patch', 'Delete'] as const;

const VERBS = ALL_VERBS;

/** `@Controller('videos')`, `@Controller("a/b")`, or bare `@Controller()`. */
const CONTROLLER_RE = /^@Controller\(\s*(?:'([^']*)'|"([^"]*)")?\s*\)/;

/** A single-line `@Post('x')` / `@Delete()` decorator on a class method. */
const VERB_RE = new RegExp(`^\\s*@(${VERBS.join('|')})\\(([^)]*)\\)\\s*$`);

/** Any verb decorator, used to detect shapes the single-line regex would miss. */
const VERB_LOOSE_RE = new RegExp(`^\\s*@(${VERBS.join('|')})\\(`);

/** The first non-decorator member signature after a verb decorator. */
const HANDLER_RE =
  /^\s*(?:public\s+|private\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(/;

function collectControllers(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectControllers(full, acc);
    } else if (entry.endsWith('.controller.ts')) {
      acc.push(full);
    }
  }
  return;
}

function joinRoute(base: string, sub: string): string {
  const joined = [base, sub].filter(Boolean).join('/');
  return `/${joined}`.replace(/\/{2,}/g, '/');
}

export interface ApiSurface {
  endpoints: MutatingEndpoint[];
  /**
   * Verb decorators whose arguments the single-line regex could not read (e.g.
   * a multi-line decorator, or a non-literal path). Non-empty means the
   * scanner is under-counting and the gate must fail rather than pass quietly.
   */
  unparsed: string[];
}

/**
 * Scan `apiSrcDir` for mutating endpoints.
 *
 * @param apiSrcDir absolute path to `apps/api/src`
 * @param repoRoot  absolute repo root, used to make `file` repo-relative
 */
export function collectMutatingEndpoints(
  apiSrcDir: string,
  repoRoot: string,
  /** Verbs to grade. Defaults to the mutating set Gate 1 has always used. */
  verbs: readonly string[] = MUTATING_VERBS
): ApiSurface {
  const wanted = new Set(verbs.map((v) => v.toUpperCase()));
  const controllers: string[] = [];
  collectControllers(apiSrcDir, controllers);
  controllers.sort();

  const endpoints: Omit<MutatingEndpoint, 'id'>[] = [];
  const unparsed: string[] = [];

  for (const file of controllers) {
    const rel = path.relative(repoRoot, file).replaceAll(path.sep, '/');
    const lines = readFileSync(file, 'utf8').split('\n');
    let base = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const controllerMatch = CONTROLLER_RE.exec(line);
      if (controllerMatch) {
        base = controllerMatch[1] ?? controllerMatch[2] ?? '';
        continue;
      }

      const verbMatch = VERB_RE.exec(line);
      if (!verbMatch) {
        const loose = VERB_LOOSE_RE.exec(line);
        // Only report an unreadable decorator for a verb this caller GRADES.
        // Otherwise a multi-line @Get would fail Gate 1, which does not grade
        // reads — the scanner would be reporting an under-count that is not
        // one.
        if (loose && wanted.has(loose[1].toUpperCase())) {
          unparsed.push(`${rel}:${i + 1}: ${line.trim()}`);
        }
        continue;
      }

      const verb = verbMatch[1].toUpperCase() as HttpVerb;
      if (!wanted.has(verb)) continue;
      const arg = verbMatch[2].trim();
      let sub = '';
      if (arg) {
        const literal = /^'([^']*)'$|^"([^"]*)"$/.exec(arg);
        if (!literal) {
          unparsed.push(`${rel}:${i + 1}: ${line.trim()}`);
          continue;
        }
        sub = literal[1] ?? literal[2] ?? '';
      }

      let handler = '<unknown>';
      for (let j = i + 1; j < Math.min(i + 40, lines.length); j++) {
        const candidate = lines[j];
        if (/^\s*@/.test(candidate)) continue;
        const handlerMatch = HANDLER_RE.exec(candidate);
        if (handlerMatch) {
          handler = handlerMatch[1];
          break;
        }
      }

      endpoints.push({
        verb,
        route: joinRoute(base, sub),
        file: rel,
        handler,
      });
    }
  }

  // Disambiguate colliding `VERB /route` pairs by suffixing the handler on
  // every member of the collision, so ids stay unique and order-independent.
  const routeCounts = new Map<string, number>();
  for (const e of endpoints) {
    const key = `${e.verb} ${e.route}`;
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
  }

  const withIds: MutatingEndpoint[] = endpoints.map((e) => {
    const key = `${e.verb} ${e.route}`;
    const id = (routeCounts.get(key) ?? 0) > 1 ? `${key}#${e.handler}` : key;
    return { ...e, id };
  });

  withIds.sort((a, b) => a.id.localeCompare(b.id));
  return { endpoints: withIds, unparsed };
}
