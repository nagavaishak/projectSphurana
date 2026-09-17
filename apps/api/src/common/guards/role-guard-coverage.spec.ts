import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * `RoleGuard` PASSES THROUGH when a handler declares neither `@RequireRole`
 * nor `@RequirePermission` (see role.guard.ts — "No role or permission
 * metadata set — passthrough"). That is a deliberate design, but it has a
 * sharp edge: a controller can list `RoleGuard` in `@UseGuards` and read as
 * authorized while being open to every member of the organization.
 *
 * That is exactly how the ENG-647 consent-form and patient-document
 * controllers shipped: both carried `@UseGuards(AuthGuard, RoleGuard)` and no
 * per-handler decorator, so the lowest-privilege member could download any
 * patient's signed consent PDF and medical documents. Nothing failed, because
 * nothing was checking.
 *
 * This test closes the class rather than the instance. It is a SOURCE scan on
 * purpose: it needs no Nest container, no database and no module graph, so it
 * cannot be defeated by a mock and cannot rot when DI wiring changes. If a
 * controller opts into `RoleGuard`, every route handler on it must say what
 * role it requires.
 *
 * To exempt a handler deliberately, annotate it — see EXEMPT_MARKER below.
 * Silence is never an exemption.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const API_SRC = join(HERE, '..', '..');

/** Opt out explicitly, in a comment on the handler, with a reason. */
const EXEMPT_MARKER = 'role-guard-exempt:';

/**
 * Pre-existing unguarded handlers, as a RATCHET.
 *
 * These controllers gate some handlers and not others — they predate this
 * check and are not ENG-647's doing. Rather than fail the build on ~113
 * historical routes or silently skip them, the count is pinned: it may not
 * grow, and when you fix some, lower the number. A controller absent from
 * this map must be fully covered, so a NEW controller can never land
 * unguarded.
 *
 * Reducing these to zero is tracked separately — most are org-scoped
 * operational reads where "any member" is plausibly the intended audience,
 * but that has never been written down, which is the actual problem.
 */
const BASELINE_UNGUARDED: Record<string, number> = {
  'assets/assets.controller.ts': 15,
  'campaigns/campaigns.controller.ts': 27,
  'leads/leads.controller.ts': 13,
  'meta-ads/meta-ads.controller.ts': 7,
  'meta-campaigns/meta-campaigns.controller.ts': 6,
  'offers/offers.controller.ts': 2,
  'org-defaults/org-defaults.controller.ts': 1,
  'organization-services/organization-services.controller.ts': 11,
  'practitioners/practitioners.controller.ts': 6,
  'social-posts/social-posts.controller.ts': 5,
};

const ROUTE_DECORATOR =
  /^\s*@(Get|Post|Put|Patch|Delete|Head|Options|All)\s*\(/;
const AUTHZ_DECORATOR = /@(RequireRole|RequirePermission)\s*\(/;
/**
 * A class member that is a method, at exactly two-space indentation:
 * `name(`, `async name(`, `private async name(`.
 *
 * Modifiers are matched as whole words each followed by its own whitespace,
 * NOT as a loose `\s` alternation — a `\s` in that group lets the pattern
 * consume deeper indentation and match statements inside a method body, so
 * `if (`, `for (` and `while (` all register as handlers.
 */
const METHOD_SIGNATURE =
  /^ {2}(?:(?:public|private|protected|readonly|static|async|override)\s+)*([a-zA-Z_$][\w$]*)\s*\(/;

/** Reserved words that can look like a method name after the modifier run. */
const NOT_A_METHOD = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'constructor',
]);

function collectControllerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectControllerFiles(full, out);
    } else if (entry.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

interface Handler {
  /** Method name, for a readable failure message. */
  name: string;
  /** 1-indexed line of the method signature. */
  line: number;
  /** Every decorator line attached to this method. */
  decorators: string[];
}

/**
 * Walk the file and pair each method signature with the contiguous run of
 * decorator lines directly above it. Handles multi-line decorators and any
 * decorator ordering, because it takes the whole run rather than assuming
 * `@Get` comes first.
 */
function parseHandlers(source: string): Handler[] {
  const lines = source.split('\n');
  const handlers: Handler[] = [];

  for (let i = 0; i < lines.length; i++) {
    const signature = METHOD_SIGNATURE.exec(lines[i]);
    if (!signature) continue;
    if (NOT_A_METHOD.has(signature[1])) continue;

    // Walk up while the lines still belong to this member's decorator run.
    // Stop at a blank line, a closing brace, or a comment block boundary —
    // anything that means the previous member ended.
    const decorators: string[] = [];
    for (let j = i - 1; j >= 0; j--) {
      const line = lines[j];
      const trimmed = line.trim();
      if (trimmed === '' || trimmed === '}' || trimmed.endsWith('};')) break;
      decorators.unshift(line);
      // A decorator run cannot extend past the class opening.
      if (trimmed.startsWith('export class') || trimmed.startsWith('class '))
        break;
    }

    if (decorators.some((d) => ROUTE_DECORATOR.test(d))) {
      handlers.push({ name: signature[1], line: i + 1, decorators });
    }
  }

  return handlers;
}

describe('RoleGuard coverage', () => {
  const controllerFiles = collectControllerFiles(API_SRC);

  it('finds controllers to check', () => {
    // Guards the guard: a broken path glob would make every assertion below
    // vacuously pass.
    expect(controllerFiles.length).toBeGreaterThan(10);
  });

  const guarded = controllerFiles.filter((file) => {
    const source = readFileSync(file, 'utf-8');
    return /@UseGuards\([^)]*\bRoleGuard\b/s.test(source);
  });

  it('finds controllers that opt into RoleGuard', () => {
    expect(guarded.length).toBeGreaterThan(0);
  });

  it.each(
    guarded.map((f) => [f.slice(API_SRC.length + 1).replace(/\\/g, '/'), f])
  )('%s — route handlers declare a required role', (display, file) => {
    const source = readFileSync(file as string, 'utf-8');
    const handlers = parseHandlers(source);

    const unguarded = handlers.filter((h) => {
      const block = h.decorators.join('\n');
      if (block.includes(EXEMPT_MARKER)) return false;
      return !AUTHZ_DECORATOR.test(block);
    });

    const allowed = BASELINE_UNGUARDED[display as string] ?? 0;

    // Exact match, both directions, on purpose:
    //
    //   got MORE than allowed — a handler listed RoleGuard but declared no
    //     @RequireRole/@RequirePermission, so the guard passes it through to
    //     any org member. Add a decorator, or justify it with a
    //     "role-guard-exempt: <reason>" comment on the handler.
    //
    //   got FEWER than allowed — you fixed some. Lower the number in
    //     BASELINE_UNGUARDED so the ratchet holds at the new level.
    //
    // For a controller not in the baseline, `allowed` is 0 and the failure
    // lists exactly which handlers are open.
    if (unguarded.length !== allowed) {
      expect(unguarded.map((h) => `${h.name} (line ${h.line})`)).toHaveLength(
        allowed
      );
    }
    expect(unguarded).toHaveLength(allowed);
  });
});
