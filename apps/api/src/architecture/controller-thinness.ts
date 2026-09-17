import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './endpoint-coverage.js';

/**
 * Static measure of the business orchestration still living in controllers.
 *
 * Input to Gate 5 in `docs/engineering/capability-architecture.md`.
 *
 * THE RULE
 * --------
 *   A controller method body may contain only: call the use case, return it.
 *   Every other concern is a decorator.
 *
 * NestJS has exactly three cross-cutting mechanisms and this codebase already
 * uses all three, so there is no concern that has to live in a handler body:
 *
 *   policy / verification  → Guard        (AuthGuard, RoleGuard, ApiKeyGuard)
 *   input shaping          → param decorator (@ActiveOrganization, @CurrentUser)
 *   output shaping         → Interceptor  (RlsInterceptor, ResponseContract…)
 *
 * Webhook signature verification, OAuth state parsing, cookie forwarding and
 * CDN URL signing were each written inline in a handler; each has a home in
 * one of those three. That is why this gate needs NO waiver list.
 *
 * WHY NO BASELINE LIST
 * --------------------
 * Gates 1, 3 and 4 ratchet over a long tail nobody will finish. This one is
 * different: a half-migrated controller layer is worse than either end state,
 * because a reader cannot tell whether "no logic here" means "already moved"
 * or "never had any", and an exception list means every reader must consult it
 * to know what normal looks like.
 *
 * So the exception surface was ONE INTEGER — a countdown, not a catalogue.
 *
 * IT REACHED 0 on 2026-07-25, from 187 sites / 8,119 lines. The constant is
 * deleted and the assertion in the spec is absolute: no controller anywhere
 * holds orchestration, and no reader has to look anything up. Every one of the
 * 187 sites found a home in a Guard, a param decorator or an Interceptor —
 * which is the concrete evidence for the claim above that no fourth category
 * exists.
 */

export const API_SRC = path.join(REPO_ROOT, 'apps/api/src');

/**
 * A handler doing parse → call → map → return fits comfortably in this.
 * Calibrated against the 47 controllers already thin: their handlers cluster
 * well below it, and everything above it turned out to hold logic.
 */
export const MAX_HANDLER_LINES = 25;

/** Boilerplate every controller carries; never orchestration. */
const TRANSPORT_MEMBERS =
  /^(mapError|mapErrorToHttpException|requireActiveOrganization|handleError|toHttpException|constructor)$/;

/** Control-flow keywords sit at class-body indent and match the member regex. */
const KEYWORD = /^(if|for|while|switch|catch|return|await|do|else|try)$/;

const VERB = /^\s*@(Get|Post|Put|Patch|Delete)\(/;
/**
 * A member declaration at class-body indent.
 *
 * The optional `<…>` group is NOT cosmetic. Without it this missed every
 * GENERIC method — `private signCdnUrl<T extends object>(…)` never matched — so
 * a controller could hold unlimited orchestration in a private helper and score
 * zero simply by taking a type parameter. Three real helpers were hiding behind
 * it when this was found, which means every count this gate has printed,
 * including its own 187 starting point, was an UNDER-count.
 *
 * That is the worse direction for a ratchet to be wrong in: an over-count
 * annoys someone, an under-count silently exempts code from the rule.
 */
const MEMBER =
  /^\s{2}(?:private\s+|public\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:<[^(]*>)?\s*\(/;
const DIRECT_DB =
  /\bdb\.(query|select|insert|update|delete|transaction)\s*[.(]/;

export type ViolationKind = 'helper' | 'fat-handler' | 'direct-db';

export interface ThicknessViolation {
  /** `path/to.controller.ts::member` — stable across unrelated edits. */
  id: string;
  file: string;
  member: string;
  kind: ViolationKind;
  lines: number;
  startLine: number;
}

function walk(dir: string, acc: string[]): void {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith('.controller.ts')) acc.push(full);
  }
}

/**
 * Locate a member's BODY braces — the `{` AFTER the signature's closing `)`.
 *
 * Brace-matching from the signature line instead counts the parameter object's
 * braces and silently truncates every multi-line signature to ~12 lines. That
 * exact bug made a 322-line method measure as 12 and hid the largest piece of
 * orchestration in the codebase, so it is worth the extra pass.
 */
function findBody(lines: string[], start: number): [number, number] | null {
  let paren = 0;
  let sigDone = false;
  let bodyStart = -1;
  outer: for (let k = start; k < lines.length; k++) {
    const from = k === start ? lines[k].indexOf('(') : 0;
    for (let c = Math.max(from, 0); c < lines[k].length; c++) {
      const ch = lines[k][c];
      if (!sigDone) {
        if (ch === '(') paren++;
        else if (ch === ')') {
          paren--;
          if (paren === 0) sigDone = true;
        }
      } else if (ch === '{') {
        bodyStart = k;
        break outer;
      }
    }
  }
  if (bodyStart < 0) return null;

  let depth = 0;
  let started = false;
  for (let k = bodyStart; k < lines.length; k++) {
    for (const ch of lines[k]) {
      if (ch === '{') {
        depth++;
        started = true;
      } else if (ch === '}') depth--;
    }
    if (started && depth <= 0) return [bodyStart, k];
  }
  return null;
}

/**
 * Every `*.controller.ts` under apps/api/src.
 *
 * Exported so the spec can assert the scanner actually FOUND something. That
 * matters more now than it did during the countdown: while violations existed,
 * a broken scanner showed up immediately as the count collapsing. At zero, a
 * scanner that silently matches no files produces exactly the same output as a
 * clean codebase — so "0 violations" is only meaningful alongside "and it read
 * N controllers".
 */
export function collectControllerFiles(): string[] {
  const files: string[] = [];
  walk(API_SRC, files);
  files.sort();
  return files;
}

export function collectThicknessViolations(): ThicknessViolation[] {
  const files = collectControllerFiles();

  const out: ThicknessViolation[] = [];
  for (const file of files) {
    const rel = path.relative(REPO_ROOT, file).replace('apps/api/src/', '');
    const lines = readFileSync(file, 'utf8').split('\n');

    for (let i = 0; i < lines.length; i++) {
      const m = MEMBER.exec(lines[i]);
      if (!m || KEYWORD.test(m[1])) continue;
      const name = m[1];

      // Walk UP through the decorator block to decide whether this member is a
      // route.
      //
      // The stop condition must NOT be "the line starts with @". A multi-line
      // decorator's continuation lines do not:
      //
      //     @MediaUrls({
      //       fields: [{ path: 'blobUrl', strategy: 'asset' }],   <- no @
      //     })
      //     @Get(':id')
      //     async findOne(...)
      //
      // Stopping there severs the walk before it reaches `@Get`, so the route
      // is misfiled as a `helper` — a controller gets MORE violations for
      // adopting the very decorator that makes it thin. Same root cause as the
      // decorator-order bug that made Gate 3 credit guards to the wrong route.
      //
      // Instead: walk up to the previous member body or the class opening, and
      // look for a verb anywhere in that block.
      let isRoute = false;
      for (let j = i - 1; j >= 0; j--) {
        const t = lines[j].trim();
        // A closing brace at member indentation ends the previous member —
        // anything above it belongs to that member, not to this one.
        if (t === '}' || /^export class /.test(lines[j])) break;
        if (VERB.test(lines[j])) {
          isRoute = true;
          break;
        }
      }

      const body = findBody(lines, i);
      if (!body) continue;
      const [bodyStart, end] = body;
      const len = end - i + 1;
      i = end;

      if (TRANSPORT_MEMBERS.test(name)) continue;

      if (!isRoute) {
        out.push({
          id: `${rel}::${name}`,
          file: rel,
          member: name,
          kind: 'helper',
          lines: len,
          startLine: bodyStart + 1,
        });
      } else if (len > MAX_HANDLER_LINES) {
        out.push({
          id: `${rel}::${name}`,
          file: rel,
          member: name,
          kind: 'fat-handler',
          lines: len,
          startLine: bodyStart + 1,
        });
      }
    }

    lines.forEach((line, n) => {
      if (!DIRECT_DB.test(line)) return;
      out.push({
        id: `${rel}::line${n + 1}`,
        file: rel,
        member: `line ${n + 1}`,
        kind: 'direct-db',
        lines: 1,
        startLine: n + 1,
      });
    });
  }
  return out;
}
