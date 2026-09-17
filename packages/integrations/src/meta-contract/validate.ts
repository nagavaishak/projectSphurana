import type { FetchInterceptor } from '@borradh-workspace/http';
import { createLogger } from '@borradh-workspace/observability';
import {
  describeGraphRequest,
  isGraphUrl,
  matchGraphRequest,
} from './match.js';
import { RESPONSE_SCHEMAS } from './response-schemas.js';

/**
 * RESPONSE-DRIFT DETECTOR.
 *
 * Enabled with `META_CONTRACT_VALIDATE=1` on the nightly real-Meta run. Passes
 * every request through to real Graph, then checks the ACTUAL response against
 * the response schema the contract fake answers from.
 *
 * This is the half of the contract we don't control. Request shapes are our own
 * code and are enforced statically by the fake; response shapes are Meta's, and
 * the only way to know they still hold is to look at real traffic on a
 * schedule. This is that look.
 *
 * REPORT-ONLY, DELIBERATELY
 * -------------------------
 * A mismatch logs a structured warning; it never fails the request or the run.
 * Two reasons:
 *   1. Response schemas are PASSTHROUGH, so a new Meta field is a non-event —
 *      but a schema written slightly too tightly would otherwise turn a routine
 *      Meta release into a red nightly.
 *   2. We want a few clean cycles of evidence before this gates anything.
 *
 * Promote to failing once the signal is proven quiet. Until then, the value is
 * that drift becomes VISIBLE within hours instead of being discovered by a
 * customer.
 *
 * Mismatches are logged rather than written to disk because this runs inside
 * the deployed API/worker on Fly, not on the CI runner — logs are retrievable
 * (BetterStack), a file on an ephemeral machine is not. Query with:
 *
 *     context:meta-contract AND drift:true
 *
 * BOUNDED BY DESIGN — READ BEFORE CHANGING
 * ----------------------------------------
 * This was written for a nightly CI run: a process that starts, does a fixed
 * amount of work, and exits. It now runs in the long-lived API and worker, and
 * two things that are free in the first case are unbounded in the second:
 *
 *   1. THE TALLY. `drifts` grew forever. Chronic drift on a high-volume path
 *      (chatbot delivery) is exactly when the array is largest and exactly when
 *      you least want a leak. Samples are capped; the COUNT is not, because a
 *      count is one number.
 *   2. THE LOG VOLUME. One warn per offending call means a single wrong schema
 *      emits a warn per message delivered, forever. Better Stack drops silently
 *      under load, so a flood doesn't just cost money — it can bury the signal
 *      it was meant to raise. Each distinct drift logs on first sight and then
 *      at 10, 100, 1000… occurrences, which answers "is this rare or constant?"
 *      without emitting a line per call.
 *
 * Signatures are keyed on `endpointId` + issue paths, never on the request
 * description: descriptions carry concrete entity ids (`POST /act_9/ads`), so
 * keying on them would be unbounded by construction.
 */

const logger = createLogger('meta-contract');

export interface DriftReport {
  endpointId: string;
  description: string;
  status: number;
  issues: string[];
  /**
   * How many times THIS drift (same endpoint, same issues) has been seen since
   * the process started. 1 on first sight; 0 means the signature table was full
   * so this one is counted in the total but not tracked individually.
   */
  occurrences: number;
}

/** Distinct drifts kept for inspection. A sample, not a log. */
const MAX_DRIFT_SAMPLES = 50;

/**
 * Distinct drift signatures tracked for de-duplication. Bounded so a pathology
 * that somehow varies its issue list can't grow the map without limit.
 */
const MAX_TRACKED_SIGNATURES = 200;

const drifts: DriftReport[] = [];
const occurrencesBySignature = new Map<string, number>();
let totalDrifts = 0;
let signatureTableFull = false;

export interface DriftSummary {
  /** Every drift seen, including ones not kept as samples. */
  total: number;
  /** Distinct (endpoint, issues) combinations seen. */
  unique: number;
  /** Bounded sample — the FIRST `MAX_DRIFT_SAMPLES` distinct-ish drifts. */
  samples: readonly DriftReport[];
  /** True when `total` exceeded what `samples` can hold. */
  truncated: boolean;
}

export function getDriftReports(): readonly DriftReport[] {
  return drifts;
}

export function getDriftSummary(): DriftSummary {
  return {
    total: totalDrifts,
    unique: occurrencesBySignature.size,
    samples: drifts,
    truncated: totalDrifts > drifts.length,
  };
}

export function resetDriftReports(): void {
  drifts.length = 0;
  occurrencesBySignature.clear();
  totalDrifts = 0;
  signatureTableFull = false;
}

/**
 * Log on first sight, then at each power of ten.
 *
 * Powers of ten rather than a fixed sample rate because the useful question is
 * an order of magnitude ("this fired once" vs "this fires on everything"), and
 * the answer costs one line per decade instead of one per call.
 *
 * Exported for direct unit testing — asserting the log-rate policy through a
 * logger mock would be worth less and cost an isolation hazard.
 */
export function isReportingMilestone(count: number): boolean {
  if (count < 1) return false;
  let milestone = 1;
  while (milestone < count) milestone *= 10;
  return milestone === count;
}

function signatureOf(endpointId: string, issues: string[]): string {
  return `${endpointId}::${issues.join('|')}`;
}

/**
 * Record one drift and return how many times it has been seen, or `null` when
 * the signature table is full and this signature is new — the caller stays
 * quiet in that case rather than logging an untracked signature on every call.
 */
function recordDrift(
  endpointId: string,
  issues: string[],
  report: DriftReport
): number | null {
  totalDrifts += 1;

  const signature = signatureOf(endpointId, issues);
  const prior = occurrencesBySignature.get(signature);

  if (prior === undefined) {
    if (occurrencesBySignature.size >= MAX_TRACKED_SIGNATURES) {
      if (!signatureTableFull) {
        signatureTableFull = true;
        logger.warn(
          'Drift signature table is full — further NEW drift signatures are counted but not logged',
          {
            drift: true,
            reason: 'signature-table-full',
            tracked: occurrencesBySignature.size,
          }
        );
      }
      return null;
    }

    occurrencesBySignature.set(signature, 1);
    if (drifts.length < MAX_DRIFT_SAMPLES) drifts.push(report);
    return 1;
  }

  const next = prior + 1;
  occurrencesBySignature.set(signature, next);
  return next;
}

/** Validate one response body. Exported for direct unit testing. */
export function validateResponse(
  endpointId: string,
  description: string,
  status: number,
  body: unknown
): DriftReport | null {
  const schema = RESPONSE_SCHEMAS[endpointId];
  if (!schema) return null;

  // Meta error envelopes are a legitimate runtime outcome (rate limits, revoked
  // tokens), not schema drift. They have their own shape and their own
  // handling; validating them against the success schema would be pure noise.
  if (status >= 400) return null;
  if (body && typeof body === 'object' && 'error' in body) return null;

  const result = schema.safeParse(body);
  if (result.success) return null;

  const issues = result.error.issues.map(
    (i) => `${i.path.join('.') || '(root)'}: ${i.message}`
  );

  const report: DriftReport = {
    endpointId,
    description,
    status,
    issues,
    occurrences: 0,
  };

  report.occurrences = recordDrift(endpointId, issues, report) ?? 0;
  return report;
}

/**
 * Collapse concrete entity ids out of a Graph path so unmatched endpoints
 * de-duplicate by SHAPE rather than by instance.
 *
 * `POST /act_9/ads` and `POST /act_4/ads` are the same finding; keying the
 * dedupe on the raw path would treat every ad account, page and campaign as a
 * new one and defeat the purpose.
 */
function pathShape(description: string): string {
  return description
    .split('/')
    .map((segment) => {
      if (/^act_\d+$/.test(segment)) return 'act_{id}';
      if (/^\d[\d_]*$/.test(segment)) return '{id}';
      return segment;
    })
    .join('/');
}

/**
 * Build the validating interceptor: real traffic, checked on the way back.
 *
 * Validation must never break the run it observes — a bug in a schema would
 * otherwise take down a real ad publish. Failures are swallowed.
 *
 * Both warnings de-duplicate (see the file header). The unmatched-endpoint one
 * matters most on a production host: OAuth endpoints are deliberately absent
 * from the registry, so without de-duplication every OAuth call any customer
 * makes would emit a warn, forever.
 */
export function createValidatingInterceptor(): FetchInterceptor {
  return async (url, init) => {
    if (!isGraphUrl(url)) return null;

    const response = await fetch(url, init);

    try {
      const method = (init.method ?? 'GET').toUpperCase();
      const description = describeGraphRequest(url, method);
      const matched = matchGraphRequest(url, method);

      if (!matched) {
        const shape = pathShape(description);
        const count = recordDrift('unmatched', [shape], {
          endpointId: 'unmatched',
          description: shape,
          status: response.status,
          issues: [shape],
          occurrences: 1,
        });

        if (count !== null && isReportingMilestone(count)) {
          logger.warn('Graph endpoint not in the contract registry', {
            drift: true,
            reason: 'unmatched-endpoint',
            description: shape,
            occurrences: count,
          });
        }
        return response;
      }

      const body = await response.clone().json();
      const report = validateResponse(
        matched.endpoint.id,
        description,
        response.status,
        body
      );

      if (report && isReportingMilestone(report.occurrences)) {
        logger.warn('Meta response drifted from the declared contract', {
          drift: true,
          reason: 'response-mismatch',
          endpointId: report.endpointId,
          description: report.description,
          issues: report.issues,
          occurrences: report.occurrences,
        });
      }
    } catch {
      // Non-JSON body, or a schema bug. Neither is worth failing a live
      // publish over.
    }

    return response;
  };
}
