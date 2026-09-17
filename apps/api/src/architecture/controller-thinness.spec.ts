import {
  MAX_HANDLER_LINES,
  collectControllerFiles,
  collectThicknessViolations,
} from './controller-thinness.js';

/**
 * ARCHITECTURE TEST — GATE 5: controllers are thin. No exceptions.
 *
 *   A controller method body may contain only: call the use case, return it.
 *   Every other concern is a decorator.
 *
 * NestJS has three cross-cutting mechanisms and this codebase already uses all
 * three, so nothing is forced to live in a handler body:
 *
 *   policy / verification  → Guard            (AuthGuard, RoleGuard, ApiKeyGuard)
 *   input shaping          → param decorator  (@ActiveOrganization, @CurrentUser)
 *   output shaping         → Interceptor      (RlsInterceptor, ResponseContract…)
 *
 * Webhook signature verification, OAuth state parsing, cookie forwarding and
 * CDN URL signing are each written inline in some handler today. Each has a
 * home in one of the three above. That is why this gate has NO waiver list —
 * there is no category of thing that legitimately needs to be in a controller.
 *
 * IT REACHED ZERO — 2026-07-25
 * ----------------------------
 * This gate ran as a countdown (one integer, never a waiver list) from 187
 * sites / 8,119 lines to 0. `MAX_REMAINING` and its `toBeLessThanOrEqual` are
 * therefore GONE, exactly as the countdown's own instructions said they should
 * be, and the assertion below is now absolute.
 *
 * That is the whole point of having chosen a number over a list. A waiver list
 * would still be here, and a reader opening any controller would still have to
 * consult it to learn what normal looks like. Now the rule needs no lookup:
 * a controller holds no orchestration, with no exceptions, and any new
 * violation fails on the spot rather than being absorbed into slack.
 *
 * DO NOT REINTRODUCE A CEILING. If a change cannot satisfy the rule, the
 * concern it is carrying belongs in a Guard, a param decorator or an
 * Interceptor — all three already exist here, and every one of the 187 sites
 * found a home in one of them.
 */

const violations = collectThicknessViolations();

function render(): string {
  const byFile = new Map<string, typeof violations>();
  for (const v of violations) {
    byFile.set(v.file, [...(byFile.get(v.file) ?? []), v]);
  }
  return [...byFile.entries()]
    .sort((a, b) => {
      const mass = (xs: typeof violations) =>
        xs.reduce((n, x) => n + x.lines, 0);
      return mass(b[1]) - mass(a[1]);
    })
    .slice(0, 20)
    .map(
      ([file, vs]) =>
        `  ${file}\n${vs
          .map(
            (v) =>
              `      ${v.kind.padEnd(12)} ${v.member} (${v.lines}L @ ${v.startLine})`
          )
          .join('\n')}`
    )
    .join('\n');
}

describe('architecture: Gate 5 — controllers hold no business orchestration', () => {
  it('finds the controller surface at all (no vacuous pass)', () => {
    // AT ZERO THIS CHECK HAD TO CHANGE, and the reason is worth keeping.
    //
    // It used to be satisfied by `violations.length === 0`, which was fine
    // while violations existed — a broken scanner showed up as the count
    // collapsing. Once the count legitimately reached 0 that shortcut made the
    // guard self-satisfying: a scanner matching NO FILES AT ALL produces the
    // identical result to a perfectly clean codebase.
    //
    // So the anchor is now the input, not the output. "Zero violations" only
    // means anything alongside "and it actually read the controllers".
    const files = collectControllerFiles();
    expect(files.length).toBeGreaterThan(40);
    expect(files.every((f) => f.endsWith('.controller.ts'))).toBe(true);
  });

  it('has no controller holding business orchestration', () => {
    if (violations.length === 0) {
      expect(violations).toEqual([]);
      return;
    }

    throw new Error(
      `Controller orchestration is back: ${violations.length} site(s). The rule is absolute.

THE RULE: a controller method body may contain only "call the use case, return it".
Everything else is a decorator — and every mechanism already exists here:

  verification / policy   -> a Guard            (see AuthGuard, RoleGuard)
  request shaping         -> a param decorator  (see @ActiveOrganization)
  response shaping        -> an Interceptor     (see ResponseContractInterceptor)

  helper       a private method on the controller -> move it to a use case
  fat-handler  a handler over ${MAX_HANDLER_LINES} lines -> the body IS the use case
  direct-db    a controller touching the database -> that is a service's job

There is no ceiling to raise — this gate reached 0 and its countdown was
deleted. Move the concern into a Guard / param decorator / Interceptor.

${render()}`
    );
  });

  it('reports zero orchestration in controllers', () => {
    const byKind = violations.reduce<Record<string, number>>((a, v) => {
      a[v.kind] = (a[v.kind] ?? 0) + 1;
      return a;
    }, {});
    const mass = violations.reduce((n, v) => n + v.lines, 0);
    // eslint-disable-next-line no-console
    console.warn(
      `Gate 5: ${violations.length} sites (${mass} lines) — ${JSON.stringify(byKind)}. Rule is absolute.`
    );
    expect(mass).toBe(0);
  });
});
