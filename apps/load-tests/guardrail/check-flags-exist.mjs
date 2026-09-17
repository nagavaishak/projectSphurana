#!/usr/bin/env node
/**
 * CI check: every non-example flag in watched-flags.json must exist in PostHog
 * and the stored flagId must match the live flag's id.
 *
 * Exits 0 (success) in these safe-skip cases:
 *   - No POSTHOG_PERSONAL_API_KEY set (CI secret not yet wired)
 *   - Zero non-example flags in config
 *
 * Exits 1 (hard fail) when:
 *   - A flag key cannot be found in PostHog
 *   - A flag's stored flagId doesn't match the live PostHog id (drift)
 *   - An enabled flag still has flagId: 0 (was never populated)
 *   - The PostHog API returns an unexpected error
 *
 * This prevents the "rollout-resumable-uploads had flagId: 0" class of bug
 * where the guardrail silently can't PATCH a flag it's supposed to halt.
 */

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

const POSTHOG_HOST = (
  process.env.POSTHOG_HOST || 'https://eu.posthog.com'
).replace(/\/+$/, '');
const PROJECT_ID = process.env.POSTHOG_PROJECT_ID || '127379';
const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY || '';
const CONFIG_PATH =
  process.env.GUARDRAIL_CONFIG || resolve(HERE, 'watched-flags.json');

function log(level, msg, extra) {
  const line = extra
    ? `[flag-check] ${level}: ${msg} ${JSON.stringify(extra)}`
    : `[flag-check] ${level}: ${msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

async function fetchFlagByKey(key) {
  const url = `${POSTHOG_HOST}/api/projects/${PROJECT_ID}/feature_flags/?search=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `PostHog API error for key '${key}': HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  const data = await res.json();
  // search is case-insensitive substring — find exact key match
  return (data.results ?? []).find((f) => f.key === key) ?? null;
}

async function main() {
  if (!API_KEY) {
    log(
      'warning',
      'POSTHOG_PERSONAL_API_KEY not set — skipping flag-existence check.'
    );
    return;
  }

  const raw = await readFile(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);
  const flags = (config.flags ?? []).filter(
    (f) => f && typeof f.key === 'string' && !f.key.startsWith('_')
  );

  if (flags.length === 0) {
    log('warning', 'No non-example flags in config — nothing to check.');
    return;
  }

  log(
    'info',
    `Checking ${flags.length} flag(s) against PostHog project ${PROJECT_ID}`
  );

  const failures = [];

  for (const flag of flags) {
    try {
      // Enabled flags with flagId: 0 are a hard misconfiguration — the guardrail
      // can evaluate them but can never PATCH them on a breach.
      if (flag.enabled && flag.flagId === 0) {
        failures.push({
          key: flag.key,
          problem:
            'flagId is 0 but flag is enabled — guardrail cannot halt this flag',
        });
        continue;
      }

      const live = await fetchFlagByKey(flag.key);

      if (!live) {
        failures.push({
          key: flag.key,
          problem: `flag key '${flag.key}' not found in PostHog — create it or remove it from watched-flags.json`,
        });
        continue;
      }

      // If a non-zero flagId is stored, verify it matches the live id.
      if (flag.flagId !== 0 && live.id !== flag.flagId) {
        failures.push({
          key: flag.key,
          problem: `flagId mismatch — watched-flags.json has ${flag.flagId} but PostHog has ${live.id}`,
          expected: flag.flagId,
          actual: live.id,
        });
        continue;
      }

      log(
        'info',
        `  ✓ ${flag.key} (id: ${live.id}, status: ${live.status ?? 'unknown'})`
      );
    } catch (err) {
      failures.push({ key: flag.key, problem: err.message });
    }
  }

  if (failures.length > 0) {
    log('error', `${failures.length} flag(s) failed existence/id check:`);
    for (const f of failures) {
      log(
        'error',
        `  ✗ ${f.key}: ${f.problem}`,
        f.expected != null
          ? { expected: f.expected, actual: f.actual }
          : undefined
      );
    }
    process.exit(1);
  }

  log('info', `All ${flags.length} flag(s) verified in PostHog.`);
}

main().catch((err) => {
  log('error', err.message);
  process.exit(1);
});
