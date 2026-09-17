/**
 * Tool-coverage declarations — the "does Claire reach this?" decision, made
 * where the tools live rather than in a manifest nobody opens.
 *
 * WHY THIS EXISTS. Gate 1 grades whether a MUTATING endpoint is reachable, and
 * records the gaps in one anonymous 275-line `UNCOVERED_BASELINE` list with no
 * reasons and no owner. Two things were wrong with that:
 *
 *   1. It never graded READS. 256 `@Get` routes were invisible to every gate,
 *      while Claire's tools are demonstrably read-heavy. A missing read is a
 *      HARDER dead end than a missing write — she cannot reschedule an
 *      appointment she cannot find — and it is the cheap half to close: no
 *      confirmation, no money, nothing irreversible.
 *   2. A list of ids is not a decision. "This endpoint is uncovered" and
 *      "we deliberately do not want Claire here" are different states, and the
 *      baseline could not tell them apart.
 *
 * So: every endpoint in a covered area gets an explicit entry, in a file that
 * sits next to the tools. Adding a route to a covered area fails the gate until
 * someone writes down what it is.
 *
 * THE VERB ASYMMETRY. The default differs by verb class, because the question
 * differs:
 *
 *   GET     — the considered act is deciding Claire should NOT see something.
 *             Prefer `exposed`. `notExposed` wants a real reason: PII, an
 *             enormous payload, staff-only, or not a capability at all (OAuth
 *             callbacks, webhook handshakes, health probes).
 *   WRITES  — the considered act is exposure itself. `exposed` additionally
 *             requires an explicit `confirm`, so whether a write needs the
 *             owner's approval is never decided by omission.
 */

/** A tool exists for this endpoint. */
export interface ExposedEntry {
  /**
   * Canonical tool name (`feature_action`, e.g. `shifts_listShifts`). The gate
   * checks it resolves against a real tool file — an `exposed` naming a tool
   * that was renamed or deleted is a lie, and that is exactly how
   * `assignLeadsToSequence` survived in a skill for a month after its tool was
   * switched off.
   */
  exposed: string;
  /**
   * Whether the tool asks the owner before acting. REQUIRED on every mutating
   * endpoint; meaningless (and rejected) on a GET.
   *
   * `false` is a legitimate answer for a low-stakes write — it just has to be
   * an answer.
   */
  confirm?: boolean;
}

/** Deliberately out of Claire's reach. */
export interface NotExposedEntry {
  /** Why. A human reads this in review; a shrug fails the gate. */
  notExposed: string;
}

/**
 * Not yet decided. The GRANDFATHER bucket, and the only entry kind that is not
 * a decision.
 *
 * It exists so migrating an area does not force someone to invent ~670 reasons
 * in an afternoon — invented reasons would be worse than none. Its total may
 * only SHRINK, and a NEWLY ADDED endpoint may never use it: if you are writing
 * the route today, you are the person who knows.
 */
export interface UndecidedEntry {
  /** Tracking reference, so the backlog has an owner rather than a vibe. */
  undecided: string;
}

export type CoverageEntry = ExposedEntry | NotExposedEntry | UndecidedEntry;

export interface AreaCoverage {
  /** Controller area, e.g. `shifts` — matches the route's first segment. */
  area: string;
  /** `"VERB /route"` → decision. Keys must match the scanner's endpoint ids. */
  entries: Readonly<Record<string, CoverageEntry>>;
}

export const isExposed = (e: CoverageEntry): e is ExposedEntry =>
  'exposed' in e;
export const isNotExposed = (e: CoverageEntry): e is NotExposedEntry =>
  'notExposed' in e;
export const isUndecided = (e: CoverageEntry): e is UndecidedEntry =>
  'undecided' in e;

/**
 * Declare an area's coverage. Pure data — this module imports nothing, so the
 * gate can load every `coverage.ts` without booting env, db, or a feature
 * barrel.
 */
export function defineCoverage(
  area: string,
  entries: Readonly<Record<string, CoverageEntry>>
): AreaCoverage {
  return { area, entries };
}
