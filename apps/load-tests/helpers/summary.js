import { textSummary } from 'https://jslib.k6.io/k6-summary/0.1.0/index.js';

/**
 * Shared k6 `handleSummary` builder.
 *
 * k6 calls a script-exported `handleSummary(data)` once, after the run ends,
 * with the full end-of-test summary object. Whatever map of `path -> content`
 * we return is written to disk (and `stdout` is printed to the console).
 *
 * See: https://grafana.com/docs/k6/latest/results-output/end-of-test/custom-summary/
 *
 * We use this to make the previously-invisible numbers (p95/p99 latency,
 * error rate, iteration counts) durable + machine-readable so the GitHub
 * Actions summary step can surface them in `$GITHUB_STEP_SUMMARY` instead of
 * only echoing metadata (scenario name, target URL, actor).
 *
 * Outputs, all under `apps/load-tests/`:
 *   - stdout                 — the normal human-readable k6 text summary
 *   - summary.json           — the FULL raw k6 summary object (for tooling)
 *   - summary-metrics.json   — a small, stable subset (the key SLO numbers)
 *   - summary.md             — a Markdown table the workflow appends to
 *                              `$GITHUB_STEP_SUMMARY`
 *
 * NOTE: file paths are relative to k6's working directory. The workflows run
 * `k6 run` from inside `apps/load-tests/`, so these land next to the scripts.
 * If you invoke k6 from the repo root, pass `K6_SUMMARY_DIR` (see below) or
 * the files land at the repo root.
 */

const SUMMARY_DIR = __ENV.K6_SUMMARY_DIR ? `${__ENV.K6_SUMMARY_DIR}/` : '';

/**
 * Pull a metric value defensively — a metric (or sub-stat) may be absent if no
 * matching samples were collected (e.g. a scenario that made zero requests).
 */
function metricValue(data, metricName, stat) {
  const metric = data.metrics?.[metricName];
  if (!metric || !metric.values) return null;
  const value = metric.values[stat];
  return typeof value === 'number' ? value : null;
}

function round(value, dp = 2) {
  if (value === null || value === undefined) return null;
  const factor = 10 ** dp;
  return Math.round(value * factor) / factor;
}

/**
 * Build the compact, stable metric subset we care about for release-safety
 * gating + trend. Faithful to k6's metric/stat names:
 *   - http_req_duration: p(95)/p(99)/avg/max in ms
 *   - http_req_failed:   `rate` is a 0..1 fraction
 *   - iterations / http_reqs: `count` totals; `rate` is per-second
 */
export function extractMetrics(data) {
  return {
    httpReqDuration: {
      avgMs: round(metricValue(data, 'http_req_duration', 'avg')),
      p95Ms: round(metricValue(data, 'http_req_duration', 'p(95)')),
      p99Ms: round(metricValue(data, 'http_req_duration', 'p(99)')),
      maxMs: round(metricValue(data, 'http_req_duration', 'max')),
    },
    httpReqFailed: {
      rate: round(metricValue(data, 'http_req_failed', 'rate'), 5),
      // Expressed as a percentage for human-friendly summary rows.
      ratePct: round(
        (metricValue(data, 'http_req_failed', 'rate') ?? 0) * 100,
        3
      ),
    },
    httpReqs: {
      count: metricValue(data, 'http_reqs', 'count'),
      ratePerSec: round(metricValue(data, 'http_reqs', 'rate')),
    },
    iterations: {
      count: metricValue(data, 'iterations', 'count'),
      ratePerSec: round(metricValue(data, 'iterations', 'rate')),
    },
    // Surface any threshold breaches explicitly. k6 already exits 99 on a
    // breach (the gate), but naming WHICH threshold failed is what turns a red
    // run into an actionable one.
    thresholdsFailed: collectFailedThresholds(data),
  };
}

/**
 * k6 records per-threshold pass/fail under `data.metrics[name].thresholds`.
 * Each entry is `{ ok: boolean, ... }` keyed by the threshold expression
 * string (e.g. "p(95)<500"). Return the list of breached ones.
 */
function collectFailedThresholds(data) {
  const failed = [];
  for (const [metricName, metric] of Object.entries(data.metrics ?? {})) {
    const thresholds = metric.thresholds;
    if (!thresholds) continue;
    for (const [expr, result] of Object.entries(thresholds)) {
      if (result && result.ok === false) {
        failed.push(`${metricName}: ${expr}`);
      }
    }
  }
  return failed;
}

function mdRow(label, value) {
  return `| ${label} | ${value ?? 'n/a'} |`;
}

/**
 * Render the metric subset as a Markdown fragment suitable for appending to
 * `$GITHUB_STEP_SUMMARY`.
 */
export function metricsMarkdown(metrics, { title } = {}) {
  const lines = [];
  if (title) lines.push(`### ${title}`, '');
  lines.push('| Metric | Value |', '| --- | --- |');
  lines.push(mdRow('Requests', metrics.httpReqs.count));
  lines.push(mdRow('Iterations', metrics.iterations.count));
  lines.push(mdRow('Error rate', `${metrics.httpReqFailed.ratePct ?? 0}%`));
  lines.push(mdRow('p95 duration', fmtMs(metrics.httpReqDuration.p95Ms)));
  lines.push(mdRow('p99 duration', fmtMs(metrics.httpReqDuration.p99Ms)));
  lines.push(mdRow('avg duration', fmtMs(metrics.httpReqDuration.avgMs)));
  lines.push(mdRow('max duration', fmtMs(metrics.httpReqDuration.maxMs)));
  lines.push('');
  if (metrics.thresholdsFailed.length > 0) {
    lines.push('**Thresholds breached:**', '');
    for (const t of metrics.thresholdsFailed) lines.push(`- \`${t}\``);
  } else {
    lines.push('All thresholds passed.');
  }
  lines.push('');
  return lines.join('\n');
}

function fmtMs(value) {
  return value === null || value === undefined ? 'n/a' : `${value} ms`;
}

/**
 * Drop-in `handleSummary` factory. Use in a script:
 *
 *   import { buildHandleSummary } from '../helpers/summary.js';
 *   export const handleSummary = buildHandleSummary('wedge');
 *
 * `label` only names the Markdown section; the metrics are read from `data`.
 */
export function buildHandleSummary(label) {
  return function handleSummary(data) {
    const metrics = extractMetrics(data);
    const md = metricsMarkdown(metrics, {
      title: `k6 — ${label} results`,
    });
    return {
      // Keep the familiar console output so local runs read normally.
      stdout: textSummary(data, { indent: ' ', enableColors: true }),
      [`${SUMMARY_DIR}summary.json`]: JSON.stringify(data, null, 2),
      [`${SUMMARY_DIR}summary-metrics.json`]: JSON.stringify(metrics, null, 2),
      [`${SUMMARY_DIR}summary.md`]: md,
    };
  };
}
