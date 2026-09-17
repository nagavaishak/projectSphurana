import { expect, test } from '@playwright/test';

/**
 * Example @quarantine-tagged spec (Pillar 2 of the release-safety strategy —
 * the flake-budget + quarantine lane + required/advisory split).
 *
 * The `@quarantine` tag in the test title is the routing primitive:
 *   - The REQUIRED bare-suite runs `--grep-invert "@quarantine"`, so a
 *     quarantined (known-flaky) test can NEVER block a push.
 *   - The ADVISORY `quarantine` job runs `--grep "@quarantine"` with
 *     `continue-on-error: true`, so it reports the flaky test's status
 *     without gating the merge.
 *
 * This spec exists ONLY to prove that routing — it is a trivial assertion,
 * not a real flaky test. See apps/app-e2e/QUARANTINE.md for the policy:
 * every real `@quarantine` tag needs a tracking issue, an owner, and a
 * re-enable deadline. Quarantine is temporary.
 *
 * This file lives at the top level of src/ so it is matched by the desktop
 * `authenticated` project regex, which is how the `--grep` / `--grep-invert`
 * verification below routes it in and out of the bare suite.
 */
test.describe('quarantine routing example', () => {
  test('routes via the @quarantine tag (advisory lane only)', async () => {
    // No browser/preview needed — this is a pure routing-proof assertion.
    expect(1 + 1).toBe(2);
  });
});
