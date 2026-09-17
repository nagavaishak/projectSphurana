import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  REPO_ROOT,
  buildCoverageReport,
  groupUncoveredByArea,
} from './endpoint-coverage.js';
import { WAIVERS } from './endpoint-coverage.manifest.js';

/**
 * ARCHITECTURE TEST — GATE 1: capability coverage.
 *
 * Gate 2 (the composition root in `apps/api/src/assistant/ports/`) proves every
 * port method has an implementation. It cannot prove a capability is MISSING —
 * a port that was never written has no method left unimplemented. That is the
 * defect this gate exists for: `shifts` has 3 mutating endpoints and 0 tools —
 * and shifts are the sole availability source, so Claire structurally could not
 * fix an unbookable service. `practitioners` 8/0, `sales` 11/0, `packages` 7/0.
 * Nothing errored; the capability simply never existed.
 *
 * HOW IT WORKS
 * ------------
 * Statically enumerate every `@Post`/`@Put`/`@Patch`/`@Delete` handler in
 * `apps/api/src/**​/*.controller.ts`, then require each one to be:
 *
 *   - covered by a method on a port in `packages/contracts/src/ports/`, or
 *   - matched by a dated waiver in `endpoint-coverage.manifest.ts`, or
 *   - present in `UNCOVERED_BASELINE` — the burn-down list.
 *
 * THE RATCHET
 * -----------
 * `UNCOVERED_BASELINE` may only SHRINK, exactly like `KNOWN_VIOLATIONS` in
 * `packages/features/src/architecture/single-writer.test.ts`:
 *
 *   - a NEW uncovered endpoint fails the gate — port it or waive it;
 *   - an entry that became covered/waived/deleted but stayed in the list fails
 *     the gate, so the fix cannot silently regress.
 *
 * DO NOT append to the baseline to make a new endpoint pass. Regenerate it only
 * when it SHRINKS:
 *
 *   UPDATE_ENDPOINT_BASELINE=1 pnpm --filter @borradh-workspace/api exec jest endpoint-coverage
 */

const MANIFEST_PATH = path.join(
  REPO_ROOT,
  'apps/api/src/architecture/endpoint-coverage.manifest.ts'
);

const report = buildCoverageReport();

/** Jest's `expect` takes no message argument, so failures throw with their own. */
function assertEmpty(actual: string[], message: string): void {
  if (actual.length > 0) throw new Error(message);
  expect(actual).toEqual([]);
}

function rewriteBaseline(ids: string[]): void {
  const source = readFileSync(MANIFEST_PATH, 'utf8');
  const body =
    ids.length === 0
      ? ''
      : `\n${ids.map((id) => `  '${id.replaceAll("'", "\\'")}',`).join('\n')}\n`;
  const declaration =
    /export const UNCOVERED_BASELINE: ReadonlySet<string> = new Set\(\[[\s\S]*?\]\);\n/;
  if (!declaration.test(source)) {
    throw new Error(
      `Could not locate the UNCOVERED_BASELINE declaration in ${MANIFEST_PATH}`
    );
  }
  writeFileSync(
    MANIFEST_PATH,
    source.replace(
      declaration,
      `export const UNCOVERED_BASELINE: ReadonlySet<string> = new Set([${body}]);\n`
    )
  );
}

const isRegenerating = process.env.UPDATE_ENDPOINT_BASELINE === '1';

describe('architecture: Gate 1 — every mutating endpoint is ported or waived', () => {
  it('parses every verb decorator it finds (no silent under-counting)', () => {
    // A decorator the scanner cannot read is an endpoint it cannot grade, which
    // would let a capability slip through the gate unnoticed.
    assertEmpty(
      report.surface.unparsed,
      `Verb decorator(s) the endpoint scanner could not parse. Put the route on a single line as a string literal, or extend api-surface.ts:\n  ${report.surface.unparsed.join('\n  ')}`
    );
  });

  it('finds the mutating surface at all', () => {
    // Guards against the scanner silently matching nothing — a bad refactor of
    // the regexes would otherwise make this whole gate pass vacuously.
    expect(report.endpoints.length).toBeGreaterThan(300);
  });

  it('has no PORT_COVERAGE entry naming a port method that does not exist', () => {
    assertEmpty(
      report.unknownPortMethods,
      `PORT_COVERAGE claims coverage via port method(s) that are not declared in\npackages/contracts/src/ports/. Either the method was deleted — in which case\nthe endpoint is uncovered again and must be re-ported — or the manifest has a\ntypo.\n\nKnown port methods: ${[...report.ports.methods].sort().join(', ') || '(none)'}\n\nUnknown:\n  ${report.unknownPortMethods.join('\n  ')}`
    );
  });

  it('has no new uncovered mutating endpoint', () => {
    if (isRegenerating) return;

    const byArea = groupUncoveredByArea(
      report.uncovered.filter((e) => report.newlyUncovered.includes(e.id))
    );

    assertEmpty(
      report.newlyUncovered,
      `New mutating endpoint(s) that no capability port exposes and no waiver covers.\n\nPick one:\n  1. Add a method to a port in packages/contracts/src/ports/ and map the\n     endpoint to it in PORT_COVERAGE — the endpoint becomes reachable by an\n     orchestrator, and the composition root then enforces an implementation.\n  2. Add a dated WAIVER with a real reason, if no orchestrator will ever call\n     it (auth, webhooks, upload transport, staff-only ops).\n\nDo NOT add it to UNCOVERED_BASELINE — that list only shrinks.\n\n${byArea
        .map(
          ({ area, ids }) =>
            `  ${area} (${ids.length})\n${ids.map((i) => `    ${i}`).join('\n')}`
        )
        .join('\n')}`
    );
  });

  it('has no stale UNCOVERED_BASELINE entries (the ratchet may only shrink)', () => {
    if (isRegenerating) return;

    assertEmpty(
      report.staleBaseline,
      `These baseline entries are no longer uncovered — they are now ported, waived,\nor deleted. Remove them from UNCOVERED_BASELINE so they can never regress:\n\n  UPDATE_ENDPOINT_BASELINE=1 pnpm --filter @borradh-workspace/api exec jest endpoint-coverage\n\n  ${report.staleBaseline.join('\n  ')}`
    );
  });

  it('has a reason and a date on every waiver', () => {
    const defects: string[] = [];
    for (const rule of WAIVERS) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(rule.since)) {
        defects.push(
          `${rule.match}: 'since' is not an ISO date (${rule.since})`
        );
      }
      if (!rule.reason || rule.reason.trim().length < 20) {
        defects.push(`${rule.match}: 'reason' is missing or too terse`);
      }
      if (!rule.category) {
        defects.push(`${rule.match}: 'category' is missing`);
      }
    }
    assertEmpty(
      defects,
      `Every waiver must carry a non-trivial reason and an ISO date — a waiver is a\nreviewable decision, not a permanent exemption:\n  ${defects.join('\n  ')}`
    );
  });

  it('has no waiver rule that matches nothing (stale exemptions)', () => {
    const matched = new Set<string>();
    for (const e of report.endpoints) {
      for (const rule of WAIVERS) {
        const target = rule.match.startsWith('/')
          ? e.route
          : `${e.verb} ${e.route}`;
        const needle = rule.match.replace(/\/+$/, '');
        if (target === needle || target.startsWith(`${needle}/`)) {
          matched.add(rule.match);
          break;
        }
      }
    }
    const unused = WAIVERS.map((r) => r.match)
      .filter((m) => !matched.has(m))
      .sort();

    assertEmpty(
      unused,
      `Waiver rule(s) that match no endpoint. The surface they exempted is gone —\ndelete them, so the waiver list stays an accurate account of what is\ndeliberately out of reach:\n  ${unused.join('\n  ')}`
    );
  });

  if (isRegenerating) {
    it('regenerates UNCOVERED_BASELINE', () => {
      const ids = report.uncovered.map((e) => e.id).sort();
      rewriteBaseline(ids);
      console.warn(
        `UNCOVERED_BASELINE rewritten with ${ids.length} entries. Review the diff: it must SHRINK. A growing baseline means a capability gap got baselined instead of decided.`
      );
      expect(ids.length).toBeGreaterThanOrEqual(0);
    });
  }
});
