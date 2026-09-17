/**
 * Global teardown: reap E2E test data from EARLIER runs.
 *
 * Calls POST /testing/cleanup with the `e2e.test.%` pattern — but only for data
 * old enough that nobody can still be using it.
 *
 * The age guard is the whole point. The suites (bare / tabs / connected / smoke
 * / quarantine) are separate GitHub jobs that run IN PARALLEL against the SAME
 * preview API and database, and each one calls this teardown when it finishes.
 * Sweeping the entire `e2e.test.%` namespace therefore deleted the users and
 * organizations that the still-running suites were in the middle of using: their
 * next sign-in answered "Invalid email or password" (the user was gone), their
 * next insert died on a foreign key (the org was gone), and sixteen unrelated
 * specs failed within the same second — which reads like a flaky app and is
 * really one job shooting the others.
 *
 * So this no longer cleans up after ITSELF; it cleans up after runs that are
 * long finished. The current run's data (seconds to minutes old) is left for the
 * next run to reap, and the preview database is per-PR and short-lived anyway.
 */
const REAP_AGE_MINUTES = 120;

async function globalTeardown() {
  const API_URL = process.env.API_URL || 'http://localhost:3000';

  if (process.env.E2E_ENV === 'staging') {
    console.log(
      '[E2E Teardown] Staging — skipping cleanup (pre-existing accounts)'
    );
    return;
  }

  const SEED_TOKEN = process.env.E2E_SEED_TOKEN;
  if (!SEED_TOKEN) {
    console.warn('[E2E Teardown] E2E_SEED_TOKEN not set — skipping cleanup');
    return;
  }

  try {
    const response = await fetch(`${API_URL}/testing/cleanup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SEED_TOKEN}`,
      },
      body: JSON.stringify({
        pattern: 'e2e.test.%',
        olderThanMinutes: REAP_AGE_MINUTES,
      }),
    });

    const data = await response.json();

    if (data.success) {
      console.log(
        `[E2E Teardown] Reaped data older than ${REAP_AGE_MINUTES}m: ${data.deleted?.organizations ?? 0} orgs, ${data.deleted?.users ?? 0} users, ${data.deleted?.verifications ?? 0} verifications`
      );
    } else {
      console.warn(`[E2E Teardown] Cleanup warning: ${data.message}`);
    }
  } catch (error) {
    console.warn(
      '[E2E Teardown] Cleanup failed:',
      error instanceof Error ? error.message : error
    );
  }
}

export default globalTeardown;
