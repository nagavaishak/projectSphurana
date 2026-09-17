/**
 * Pure SLO-breach decision logic for the flag-rollout guardrail (P4).
 *
 * Separated from all I/O (no PostHog calls, no `fetch`, no `process`) so it is
 * trivially unit-testable and deterministic — the workflow + runner
 * (`check-rollout.mjs`) own the network; this module owns the *judgement*.
 *
 * The contract mirrors the release-safety strategy (Pillar 1, "the ramp needs
 * an auto-guardrail"): given a flag's measured SLO metrics and the per-flag
 * thresholds from `watched-flags.json`, decide whether the rollout has BREACHED
 * and must be auto-halted.
 *
 * @typedef {Object} SloMetrics
 * @property {number} [errorRate]   Fraction in [0,1] — failed / total for the flag-on cohort.
 * @property {number} [p95Ms]       p95 latency in milliseconds for the guarded path.
 * @property {number} [conversion]  Fraction in [0,1] — a key conversion rate for the flag-on cohort.
 * @property {number} [sampleSize]  Number of underlying events the metrics were computed from.
 *
 * @typedef {Object} SloThresholds
 * @property {number} [maxErrorRate]      Breach if errorRate exceeds this (e.g. 0.05 = 5%).
 * @property {number} [maxP95Ms]          Breach if p95Ms exceeds this.
 * @property {number} [minConversion]     Breach if conversion falls BELOW this.
 * @property {number} [minSampleSize]     Below this, metrics are statistically meaningless → no breach (avoid acting on noise).
 *
 * @typedef {Object} BreachReason
 * @property {'errorRate'|'p95Ms'|'conversion'} metric
 * @property {number} observed
 * @property {number} threshold
 * @property {string} detail
 */

/** Default floor for acting on a metric — never auto-halt off a handful of events. */
export const DEFAULT_MIN_SAMPLE_SIZE = 100;

/**
 * Decide whether a flag's measured metrics breach its SLO thresholds.
 *
 * Design choices that keep this SAFE (a guardrail must never make things worse):
 *  - **Insufficient sample → never breach.** Acting on noise would auto-halt a
 *    healthy ramp. If `sampleSize < minSampleSize` we return `decision: 'insufficient-data'`.
 *  - **Missing metric → that check is skipped,** not treated as a breach. A
 *    metric the query couldn't compute (e.g. no conversion events yet) must not
 *    halt a flag on its own; only a metric that is present AND over/under bound
 *    counts.
 *  - **Multiple breaches are all reported** so the runner logs the full picture,
 *    but ANY single breach is sufficient to halt.
 *
 * @param {SloMetrics} metrics
 * @param {SloThresholds} thresholds
 * @returns {{ decision: 'ok'|'breach'|'insufficient-data', reasons: BreachReason[], sampleSize: number, minSampleSize: number }}
 */
export function decideBreach(metrics, thresholds) {
  const m = metrics ?? {};
  const t = thresholds ?? {};
  const minSampleSize =
    typeof t.minSampleSize === 'number'
      ? t.minSampleSize
      : DEFAULT_MIN_SAMPLE_SIZE;
  const sampleSize = typeof m.sampleSize === 'number' ? m.sampleSize : 0;

  // Statistically meaningless → explicitly NOT a breach. Never halt off noise.
  if (sampleSize < minSampleSize) {
    return {
      decision: 'insufficient-data',
      reasons: [],
      sampleSize,
      minSampleSize,
    };
  }

  /** @type {BreachReason[]} */
  const reasons = [];

  // Error-rate ceiling: breach if present AND above the cap.
  if (
    typeof t.maxErrorRate === 'number' &&
    typeof m.errorRate === 'number' &&
    m.errorRate > t.maxErrorRate
  ) {
    reasons.push({
      metric: 'errorRate',
      observed: m.errorRate,
      threshold: t.maxErrorRate,
      detail: `error rate ${(m.errorRate * 100).toFixed(2)}% > ${(t.maxErrorRate * 100).toFixed(2)}%`,
    });
  }

  // p95 latency ceiling.
  if (
    typeof t.maxP95Ms === 'number' &&
    typeof m.p95Ms === 'number' &&
    m.p95Ms > t.maxP95Ms
  ) {
    reasons.push({
      metric: 'p95Ms',
      observed: m.p95Ms,
      threshold: t.maxP95Ms,
      detail: `p95 ${Math.round(m.p95Ms)}ms > ${Math.round(t.maxP95Ms)}ms`,
    });
  }

  // Conversion FLOOR: breach if present AND below the minimum (a regression in a
  // key funnel step is just as much an SLO breach as an error spike).
  if (
    typeof t.minConversion === 'number' &&
    typeof m.conversion === 'number' &&
    m.conversion < t.minConversion
  ) {
    reasons.push({
      metric: 'conversion',
      observed: m.conversion,
      threshold: t.minConversion,
      detail: `conversion ${(m.conversion * 100).toFixed(2)}% < ${(t.minConversion * 100).toFixed(2)}%`,
    });
  }

  return {
    decision: reasons.length > 0 ? 'breach' : 'ok',
    reasons,
    sampleSize,
    minSampleSize,
  };
}
