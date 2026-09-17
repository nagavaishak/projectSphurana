#!/usr/bin/env node
/**
 * Flag-rollout guardrail runner (P4 — "the ramp needs an auto-guardrail").
 *
 * For every ENABLED flag in `watched-flags.json`, query its live SLOs from
 * PostHog (error rate / p95 / a key conversion over a recent window) and, on an
 * SLO breach, AUTO-HALT the rollout — set the flag's `rollout_percentage` to 0
 * (or fully disable it), so a flagged regression reverts without a redeploy.
 * This is the operational half of the release-safety flag system whose pure
 * core (`isInRollout` / `resolveKillSwitch`) already lives in
 * `@borradh-workspace/observability`.
 *
 * The BREACH JUDGEMENT is the pure `decideBreach()` in `./decide.mjs` (unit
 * tested). This file owns only I/O: PostHog query + PostHog PATCH + logging.
 *
 * SAFE-BY-DEFAULT behaviour (a guardrail must never make things worse):
 *   - No `POSTHOG_PERSONAL_API_KEY`  -> no-op, exit 0 (warn). Not yet wired.
 *   - No enabled flags               -> no-op, exit 0 (warn).
 *   - A query error for one flag     -> that flag is skipped (logged), others continue.
 *   - Insufficient sample            -> never halts (decideBreach returns 'insufficient-data').
 *   - `--dry-run` (or DRY_RUN=1 / no PATCH perms) -> evaluate + log, never PATCH.
 *
 * Exit codes:
 *   0  ran cleanly (whether or not a flag was halted — a halt is the SYSTEM
 *      WORKING, not a CI failure; the workflow surfaces halts via its summary +
 *      Slack, it does not fail the job on a halt).
 *   1  a hard configuration/runtime error (bad config file, PATCH failed while
 *      trying to halt a real breach — that's worth failing loudly on).
 *
 * Env:
 *   POSTHOG_PERSONAL_API_KEY  (required to do anything; absent -> clean no-op)
 *   POSTHOG_PROJECT_ID        (default 127379 — the Production project)
 *   POSTHOG_HOST              (default https://eu.posthog.com)
 *   GUARDRAIL_CONFIG          (path to watched-flags.json; default: alongside this file)
 *   DRY_RUN=1                 (evaluate + log, never PATCH)
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideBreach } from './decide.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const POSTHOG_HOST = (
  process.env.POSTHOG_HOST || 'https://eu.posthog.com'
).replace(/\/+$/, '');
// Production PostHog project (Borradh) — see reference_posthog_topology.
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID || '127379';
const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY || '';
const DRY_RUN =
  process.env.DRY_RUN === '1' || process.argv.includes('--dry-run');
const CONFIG_PATH =
  process.env.GUARDRAIL_CONFIG || resolve(HERE, 'watched-flags.json');

/** Structured log line so the workflow summary / log search stays greppable. */
function log(level, msg, extra) {
  const line = extra
    ? `[guardrail] ${level}: ${msg} ${JSON.stringify(extra)}`
    : `[guardrail] ${level}: ${msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

/** Read + parse the watched-flags config. Throws (exit 1) on a malformed file. */
async function loadConfig(path) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    throw new Error(`cannot read guardrail config at ${path}: ${err.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`guardrail config is not valid JSON: ${err.message}`);
  }
  const flags = Array.isArray(parsed.flags) ? parsed.flags : [];
  return flags.filter((f) => f && f.enabled === true);
}

/** POST a HogQL query to PostHog; returns the first result row (array) or null. */
async function hogql(query) {
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${PROJECT_ID}/query/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      query: { kind: 'HogQLQuery', query },
      name: 'flag-rollout-guardrail',
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `PostHog query failed: HTTP ${res.status} ${body.slice(0, 300)}`
    );
  }
  const data = await res.json();
  const rows = Array.isArray(data.results) ? data.results : [];
  return rows[0] ?? null;
}

/**
 * Measure a flag's SLOs from `trackedResult` events over the lookback window.
 *
 * `trackedResult` (packages/observability) emits one event per service call
 * named `<operation>.success` / `<operation>.error`. We attribute events to the
 * flag-on cohort via a `feature_flag_key` event property equal to the flag key
 * (the call sites that gate on a flag are expected to tag their trackedResult
 * properties with it — this is the wiring the strategy lists as a P4 TODO).
 *
 * Returns { errorRate, p95Ms, conversion, sampleSize } — any field the query
 * can't compute is left undefined and decideBreach skips that check.
 */
async function measureFlag(flag) {
  const lookbackHours = Number(flag.lookbackHours) || 2;
  const key = String(flag.key).replace(/'/g, "''"); // HogQL string-literal escape

  // Error rate + sample size + p95 latency for this flag's cohort.
  // `properties.feature_flag_key` is the cohort tag; `event like '%.error'`
  // counts the trackedResult error events, total counts success+error.
  // `duration_ms` is the latency property trackedResult emits on every
  // success/error event (packages/observability/src/tracked.ts) — NOT `$duration`.
  const sloRow = await hogql(`
    SELECT
      count() AS total,
      countIf(event like '%.error') AS errors,
      quantile(0.95)(toFloat(properties.duration_ms)) AS p95_ms
    FROM events
    WHERE timestamp >= now() - INTERVAL ${lookbackHours} HOUR
      AND properties.feature_flag_key = '${key}'
      AND (event like '%.success' OR event like '%.error')
  `);

  const metrics = {};
  if (sloRow) {
    const total = Number(sloRow[0]) || 0;
    const errors = Number(sloRow[1]) || 0;
    const p95 = sloRow[2] == null ? undefined : Number(sloRow[2]);
    metrics.sampleSize = total;
    if (total > 0) metrics.errorRate = errors / total;
    if (typeof p95 === 'number' && !Number.isNaN(p95)) metrics.p95Ms = p95;
  } else {
    metrics.sampleSize = 0;
  }

  // Optional conversion: fraction of cohort sessions that fired the conversion
  // event. Computed as conversionEvents / distinct cohort persons — a rough but
  // directional funnel signal. Skipped entirely when conversionEvent is unset.
  if (flag.conversionEvent && metrics.sampleSize > 0) {
    const evt = String(flag.conversionEvent).replace(/'/g, "''");
    const convRow = await hogql(`
      SELECT
        countIf(event = '${evt}') AS conversions,
        count(DISTINCT person_id) AS cohort
      FROM events
      WHERE timestamp >= now() - INTERVAL ${lookbackHours} HOUR
        AND properties.feature_flag_key = '${key}'
    `);
    if (convRow) {
      const conversions = Number(convRow[0]) || 0;
      const cohort = Number(convRow[1]) || 0;
      if (cohort > 0) metrics.conversion = conversions / cohort;
    }
  }

  return metrics;
}

/** Halt (rollout -> 0) or disable (active -> false) a flag via the PostHog API. */
async function haltFlag(flag) {
  const action = flag.action === 'disable' ? 'disable' : 'halt';
  const body =
    action === 'disable'
      ? { active: false }
      : { filters: { groups: [{ properties: [], rollout_percentage: 0 }] } };

  const res = await fetch(
    `${POSTHOG_HOST}/api/projects/${PROJECT_ID}/feature_flags/${flag.flagId}/`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `PATCH feature_flag ${flag.flagId} (${action}) failed: HTTP ${res.status} ${text.slice(0, 300)}`
    );
  }
  return action;
}

async function main() {
  if (!API_KEY) {
    log(
      'warning',
      'POSTHOG_PERSONAL_API_KEY is not set — no-op. Set the secret + populate watched-flags.json to activate (see flag-rollout-guardrail.yml).'
    );
    return { halted: [], evaluated: 0 };
  }

  const flags = await loadConfig(CONFIG_PATH);
  if (flags.length === 0) {
    log(
      'warning',
      `no enabled flags in ${CONFIG_PATH} — nothing to watch (no-op). Add an entry with enabled:true to start guarding a ramp.`
    );
    return { halted: [], evaluated: 0 };
  }

  log(
    'info',
    `evaluating ${flags.length} flag(s) against project ${PROJECT_ID} on ${POSTHOG_HOST}${DRY_RUN ? ' (dry-run)' : ''}`
  );

  const halted = [];
  let hardError = null;

  for (const flag of flags) {
    try {
      const metrics = await measureFlag(flag);
      const result = decideBreach(metrics, flag.thresholds || {});
      log('info', `flag '${flag.key}' -> ${result.decision}`, {
        metrics,
        sampleSize: result.sampleSize,
        minSampleSize: result.minSampleSize,
        reasons: result.reasons.map((r) => r.detail),
      });

      if (result.decision !== 'breach') continue;

      const summary = result.reasons.map((r) => r.detail).join('; ');
      if (DRY_RUN) {
        log(
          'warning',
          `BREACH (dry-run, NOT halting) flag '${flag.key}': ${summary}`
        );
        halted.push({ key: flag.key, dryRun: true, reasons: summary });
        continue;
      }

      const action = await haltFlag(flag);
      log(
        'error',
        `BREACH — ${action === 'disable' ? 'DISABLED' : 'HALTED (rollout->0)'} flag '${flag.key}': ${summary}`
      );
      halted.push({ key: flag.key, action, reasons: summary });
    } catch (err) {
      // A measurement error for one flag must not stop the others. But a PATCH
      // failure while trying to halt a REAL breach is worth failing the job on.
      log('error', `flag '${flag.key}' errored: ${err.message}`);
      if (/PATCH feature_flag/.test(err.message)) hardError = err;
    }
  }

  // Emit a machine-readable result for the workflow summary step.
  if (process.env.GITHUB_OUTPUT) {
    const { appendFile } = await import('node:fs/promises');
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `halted_count=${halted.length}\nhalted_json=${JSON.stringify(halted)}\n`
    );
  }

  if (hardError) throw hardError;
  return { halted, evaluated: flags.length };
}

main()
  .then((r) => {
    log('info', `done — evaluated ${r.evaluated}, halted ${r.halted.length}`);
    process.exit(0);
  })
  .catch((err) => {
    log('error', err.message);
    process.exit(1);
  });
