import { areaOf, buildToolCoverageReport } from './tool-coverage.js';
import { UNDECIDED_CEILING } from './tool-coverage.manifest.js';

/**
 * ARCHITECTURE TEST — GATE 6: every endpoint declares whether Claire reaches it.
 *
 * Gate 1 asks whether a MUTATING endpoint is ported, and parks the gaps in one
 * anonymous baseline list. This gate asks a different question of a bigger
 * surface, and demands an answer per endpoint, in a file next to the tools.
 *
 * WHAT IT ADDS OVER GATE 1
 * ------------------------
 *   - READS. Gate 1 grades 418 mutating endpoints. There are 673. The other
 *     255 are `@Get`, and no gate has ever looked at them — while Claire's
 *     tools are demonstrably read-heavy. A missing read is a harder dead end
 *     than a missing write (she cannot reschedule an appointment she cannot
 *     find) and it is the cheap half to close: no confirmation, no money,
 *     nothing irreversible.
 *   - A DECISION, not a list. "Uncovered" and "deliberately out of reach" are
 *     different states. `UNCOVERED_BASELINE` cannot tell them apart; three
 *     entry kinds can.
 *   - VERIFIED claims. `exposed: 'leads_listLeads'` is checked against the
 *     real `*.tool.ts` sources. `assignLeadsToSequence` survived in a skill for
 *     a month after its tool was switched off precisely because nothing tied
 *     the claim to the implementation.
 *   - CONFIRMATION IS EXPLICIT. A write may not be exposed without saying
 *     whether the owner is asked first. `false` is a fine answer; silence is
 *     not.
 *
 * WHERE IT STANDS
 * ---------------
 * All 75 areas are migrated, so full coverage is now ABSOLUTE — the area
 * ceiling reached 0 and was deleted rather than left at 0, because a number
 * earned to zero quietly re-licenses the thing it retired. A new controller
 * area fails outright.
 *
 * One ratchet remains: `UNDECIDED_CEILING`, the grandfather bucket, which may
 * only shrink.
 *
 * The property that does the day-to-day work: every endpoint in an area must
 * be declared, so adding a route to `leads` fails this gate until someone
 * writes down what it is. That is the case a per-AREA gate would miss, and the
 * whole reason the unit is the endpoint.
 */

const report = buildToolCoverageReport();

/** Jest's `expect` takes no message argument, so failures throw with their own. */
function assertEmpty(actual: string[], message: string): void {
  if (actual.length > 0) throw new Error(message);
  expect(actual).toEqual([]);
}

describe('architecture: Gate 6 — every endpoint declares its tool coverage', () => {
  it('parses every verb decorator it finds (no silent under-counting)', () => {
    // A decorator the scanner cannot read is an endpoint it cannot grade,
    // which would let a capability slip through unnoticed.
    assertEmpty(
      report.surfaceUnparsed,
      `Verb decorator(s) the endpoint scanner could not parse. Put the route on a single line as a string literal, or extend api-surface.ts:\n  ${report.surfaceUnparsed.join('\n  ')}`
    );
  });

  it('reads a name out of every tool file', () => {
    // If a tool's descriptor is unreadable, every `exposed:` naming it would
    // be accepted without a check — the gate would pass vacuously on the one
    // thing it exists to verify.
    assertEmpty(
      report.toolsUnparsed,
      `Tool file(s) with no readable feature/action pair. The gate resolves names as \`feature_action\`; without both it cannot verify any exposed: that points here:\n  ${report.toolsUnparsed.join('\n  ')}`
    );
  });

  it('finds the full surface, reads included', () => {
    // Guards against the scanner silently matching nothing, and specifically
    // against a regression to mutating-only: the read half is the point.
    expect(report.endpoints.length).toBeGreaterThan(600);
    expect(report.endpoints.some((e) => e.verb === 'GET')).toBe(true);
  });

  it('declares every endpoint in a migrated area', () => {
    const undeclared = report.defects
      .filter((d) => d.kind === 'undeclared')
      .map((d) => d.detail);

    assertEmpty(
      undeclared,
      `Endpoint(s) in a MIGRATED area with no coverage entry.\n\nThis is the gate doing its job: you added a route to an area that has already\ndecided what Claire reaches, so the new route needs a decision too. Open that\narea's coverage.ts and add one of:\n\n  { exposed: 'area_toolName', confirm: true|false }   // writes must say\n  { exposed: 'area_toolName' }                        // reads\n  { notExposed: 'why a human would agree' }\n  { undecided: 'TICKET' }   // only if this endpoint predates the area's file\n\n  ${undeclared.join('\n  ')}`
    );
  });

  it('has no stale entry naming an endpoint that no longer exists', () => {
    const stale = report.defects
      .filter((d) => d.kind === 'stale')
      .map((d) => d.detail);

    assertEmpty(
      stale,
      `Coverage entr(ies) for endpoints that do not exist. The route was renamed\nor deleted; the decision about it is now fiction. Remove or update:\n\n  ${stale.join('\n  ')}`
    );
  });

  it('names a real tool in every exposed entry', () => {
    const unknown = report.defects
      .filter((d) => d.kind === 'unknown-tool')
      .map((d) => d.detail);

    assertEmpty(
      unknown,
      `exposed: naming a tool that does not exist.\n\nThe claim and the implementation have diverged — which is exactly how\n\`assignLeadsToSequence\` stayed in a skill for a month after its tool was\nswitched off. Either restore the tool or change the entry to notExposed.\n\n  ${unknown.join('\n  ')}`
    );
  });

  it('requires an explicit confirm decision on every exposed write', () => {
    const missing = report.defects
      .filter(
        (d) => d.kind === 'missing-confirm' || d.kind === 'confirm-on-read'
      )
      .map((d) => d.detail);

    assertEmpty(
      missing,
      `Confirmation must be a decision, not an omission.\n\nA write Claire can call either asks the owner first or does not, and which one\nis a product judgement that should be visible in review — not inferred from\nthe absence of a field.\n\n  ${missing.join('\n  ')}`
    );
  });

  it('has a real reason on every notExposed entry', () => {
    const weak = report.defects
      .filter((d) => d.kind === 'weak-reason')
      .map((d) => d.detail);

    assertEmpty(
      weak,
      `A withheld capability needs a reason a human reads in review. "Not needed"\nis how a gap becomes permanent by accident.\n\n  ${weak.join('\n  ')}`
    );
  });

  it('declares each endpoint exactly once', () => {
    const dupes = report.defects
      .filter((d) => d.kind === 'duplicate')
      .map((d) => d.detail);

    assertEmpty(
      dupes,
      `An endpoint declared by two areas. Two owners means neither is\nresponsible, and the two can disagree:\n\n  ${dupes.join('\n  ')}`
    );
  });

  it('has a coverage.ts for EVERY route area — the rule is absolute', () => {
    const areas = new Set(report.endpoints.map((e) => areaOf(e.route)));
    for (const covered of report.coveredAreas) areas.delete(covered);
    const uncovered = [...areas].sort();

    // eslint-disable-next-line no-console
    console.warn(
      `Gate 6: ${report.coveredAreas.length} areas, ${report.endpoints.length} endpoints (${report.endpoints.filter((e) => e.verb === 'GET').length} reads). ` +
        `${report.exposedCount} exposed, ${report.notExposedCount} deliberately withheld, ${report.undecided.length} undecided.`
    );

    // This started as a ratchet with a ceiling of 73 and was burned to 0, so
    // the ceiling is gone. A number that has been earned to zero should stop
    // being a number, or it quietly re-licenses the thing it was retiring —
    // the Gate 5 lesson.
    assertEmpty(
      uncovered,
      `Route area(s) with no coverage.ts:\n\n  ${uncovered.join(', ')}\n\nA new area is a new capability that nobody has decided about. Create\napps/api/src/assistant/tools/<area>/coverage.ts and declare every one of its\nendpoints as exposed / notExposed / undecided.\n\nIf the area name is not a valid directory (the root controller's area is the\nempty string), name the directory anything — _root, _c — and put the real\narea string in defineCoverage(). The gate keys off the string, not the folder.`
    );
  });

  it('does not grow the undecided backlog (the ratchet may only shrink)', () => {
    if (report.undecided.length > UNDECIDED_CEILING) {
      throw new Error(
        `${report.undecided.length} endpoints are parked as \`undecided\`, above the ceiling of ${UNDECIDED_CEILING}.\n\n\`undecided\` is a GRANDFATHER bucket for endpoints that predate their\narea's coverage file. A route you are writing today may not use it —\nyou are the person who knows. Use exposed: or notExposed:.\n\n  ${report.undecided.join('\n  ')}`
      );
    }
    expect(report.undecided.length).toBeLessThanOrEqual(UNDECIDED_CEILING);
  });
});
