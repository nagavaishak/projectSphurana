import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './endpoint-coverage.js';
import { type EntryPoint, collectEntryPoints } from './entry-point-policy.js';
import { UNDECLARED_POLICY_BASELINE } from './entry-point-policy.manifest.js';

/**
 * ARCHITECTURE TEST — GATE 3: every entry point declares a policy.
 *
 * Gate 1 asks whether a capability EXISTS. Gate 2 asks whether it has an
 * implementation. Gate 4 asks whether its response is derived. None of them
 * asks WHO MAY CALL IT.
 *
 * That question has to be answerable before any policy moves out of a Nest
 * guard, which is the architecture doc's explicit precondition: guards are
 * good precisely because `@RequireRole('admin')` on a route is declarative and
 * greppable, and moving policy into a use case forfeits that unless something
 * counts what was moved. This gate is that counter.
 *
 * WHAT COUNTS AS DECLARING
 * ------------------------
 *   controller route — an auth-bearing guard in scope (`@UseGuards` on the
 *                      class or the method), a `@RequireRole` /
 *                      `@RequirePermission`, or an explicit public marker.
 *   claire tool      — `ToolDefinition.policy`.
 *
 * `destructive: true` does NOT count. It is a human-in-the-loop confirmation
 * gate ("ask before doing this"), not authorization ("this caller may not do
 * this at all"). Treating the two as one is exactly how a capability carrying
 * `@RequireRole('admin')` over HTTP ends up reachable through Claire by any
 * member.
 *
 * THE RATCHET
 * -----------
 * `UNDECLARED_POLICY_BASELINE` may only SHRINK, like `KNOWN_VIOLATIONS` in
 * `packages/features/src/architecture/single-writer.test.ts`. A NEW undeclared
 * entry point fails. An entry that gained a policy but stayed in the list
 * fails, so the win cannot silently regress.
 *
 *   UPDATE_POLICY_BASELINE=1 pnpm --filter @borradh-workspace/api exec jest entry-point-policy
 *
 * WHAT THIS GATE CANNOT DO
 * ------------------------
 * It cannot tell whether a declared policy is the RIGHT one. `@UseGuards(
 * AuthGuard)` on a route that should be owner-only satisfies this gate
 * completely. It converts "nobody stated a policy" into "somebody stated one",
 * which is a strictly weaker claim than "the policy is correct" — and worth
 * saying out loud, because a gate whose name overstates it is the failure this
 * whole document is about.
 *
 * Worker jobs are NOT scanned; see the note at the foot of
 * `entry-point-policy.ts` for the reasoning and how to overturn it.
 */

const MANIFEST_PATH = path.join(
  REPO_ROOT,
  'apps/api/src/architecture/entry-point-policy.manifest.ts'
);

const entryPoints = collectEntryPoints();
const undeclared = entryPoints.filter((e) => e.policy === null);

function describe_(e: EntryPoint): string {
  return `  [${e.kind}] ${e.id}\n      ${e.file}`;
}

function rewriteBaseline(ids: string[]): void {
  const source = readFileSync(MANIFEST_PATH, 'utf8');
  const body =
    ids.length === 0
      ? ''
      : `\n${ids.map((id) => `  '${id.replaceAll("'", "\\'")}',`).join('\n')}\n`;
  const declaration =
    /export const UNDECLARED_POLICY_BASELINE: ReadonlySet<string> = new Set\(\[[\s\S]*?\]\);\n/;
  if (!declaration.test(source)) {
    throw new Error(
      `Could not locate UNDECLARED_POLICY_BASELINE in ${MANIFEST_PATH}`
    );
  }
  writeFileSync(
    MANIFEST_PATH,
    source.replace(
      declaration,
      `export const UNDECLARED_POLICY_BASELINE: ReadonlySet<string> = new Set([${body}]);\n`
    )
  );
}

const isRegenerating = process.env.UPDATE_POLICY_BASELINE === '1';

describe('architecture: Gate 3 — every entry point declares a policy', () => {
  it('finds both kinds of entry point (no silent under-counting)', () => {
    // A scanner that matches nothing would make this gate pass vacuously.
    const routes = entryPoints.filter((e) => e.kind === 'controller-route');
    const tools = entryPoints.filter((e) => e.kind === 'claire-tool');
    expect(routes.length).toBeGreaterThan(300);
    expect(tools.length).toBeGreaterThan(80);
  });

  it('has no NEW entry point without a declared policy', () => {
    if (isRegenerating) return;

    const fresh = undeclared
      .filter((e) => !UNDECLARED_POLICY_BASELINE.has(e.id))
      .sort((a, b) => a.id.localeCompare(b.id));

    if (fresh.length > 0) {
      throw new Error(
        `Entry point(s) that declare no policy — nothing says who may call them.

  controller route: put an auth-bearing guard in scope (@UseGuards on the class
                    or the method), add @RequireRole/@RequirePermission, or mark
                    it explicitly public. "Open on purpose" and "nobody thought
                    about it" are indistinguishable to a reader otherwise.
  claire tool:      set \`policy\` on the tool definition. Note that
                    \`destructive: true\` is a CONFIRMATION gate, not an
                    authorization one, and does not satisfy this.

Do NOT add these to UNDECLARED_POLICY_BASELINE; that list only shrinks.

${fresh.map(describe_).join('\n')}`
      );
    }
    expect(fresh).toEqual([]);
  });

  it('has no stale baseline entry (the ratchet may only shrink)', () => {
    if (isRegenerating) return;

    const live = new Set(undeclared.map((e) => e.id));
    const stale = [...UNDECLARED_POLICY_BASELINE]
      .filter((id) => !live.has(id))
      .sort();

    if (stale.length > 0) {
      throw new Error(
        `Entry point(s) gained a policy. Lock the win in so it cannot regress:

  UPDATE_POLICY_BASELINE=1 pnpm --filter @borradh-workspace/api exec jest entry-point-policy

${stale.map((id) => `  ${id}`).join('\n')}`
      );
    }
    expect(stale).toEqual([]);
  });

  it('regenerates UNDECLARED_POLICY_BASELINE', () => {
    if (!isRegenerating) return;
    const ids = [...new Set(undeclared.map((e) => e.id))].sort();
    rewriteBaseline(ids);
    const tools = undeclared.filter((e) => e.kind === 'claire-tool').length;
    const routes = undeclared.filter(
      (e) => e.kind === 'controller-route'
    ).length;
    // eslint-disable-next-line no-console
    console.warn(
      `UNDECLARED_POLICY_BASELINE rewritten: ${ids.length} ids (${routes} routes, ${tools} tools). Review the diff — it must SHRINK.`
    );
    expect(ids.length).toBeGreaterThanOrEqual(0);
  });
});
