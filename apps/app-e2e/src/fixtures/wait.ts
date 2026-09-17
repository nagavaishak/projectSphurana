import type { Locator, Page } from '@playwright/test';

/**
 * Probes that actually WAIT.
 *
 * `locator.isVisible()` returns immediately — its `timeout` option is ignored —
 * so it races the render: a guard built on it takes the wrong branch (or skips)
 * simply because the element hadn't painted yet. These helpers give you the
 * same boolean, but derived from a real `waitFor()`, so "false" means "did not
 * appear within `timeoutMs`" rather than "wasn't there this microsecond".
 *
 * Use them ONLY where a boolean is genuinely needed (optional UI, retry loops,
 * sanctioned external-constraint skips). For an assertion, use
 * `await expect(locator).toBeVisible()`.
 */
export async function isVisibleWithin(
  locator: Locator,
  timeoutMs = 2_000
): Promise<boolean> {
  return locator
    .waitFor({ state: 'visible', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

/** Inverse of {@link isVisibleWithin}: true once the locator is gone/hidden. */
export async function isHiddenWithin(
  locator: Locator,
  timeoutMs = 2_000
): Promise<boolean> {
  return locator
    .waitFor({ state: 'hidden', timeout: timeoutMs })
    .then(() => true)
    .catch(() => false);
}

/**
 * Fill every still-empty "Email address *" input on the onboarding team step.
 *
 * The row list is NOT stable while you work on it. The analyzer's discovered
 * practitioners hydrate after the step mounts, and filling one row can itself
 * re-render the list (the owner row de-duplicates) — so an index captured
 * beforehand is stale by the time it is typed into, which is how this failed:
 * `locator.fill` waiting forever on `nth(1)` after the row had gone.
 *
 * `locator.all()` does NOT help — it returns positional locators, not element
 * handles, so nth(1) is re-resolved at fill time and races the same way.
 *
 * So: re-query every pass, fill the FIRST empty input, and repeat until none
 * are left. Bounded so a row that can never be filled fails loudly instead of
 * spinning.
 */
export async function fillEmptyTeamEmails(
  page: Page,
  addressFor: (index: number) => string
): Promise<number> {
  const inputs = page.getByPlaceholder('Email address *');
  let filled = 0;

  for (let pass = 0; pass < 12; pass++) {
    const emptyIndex = await inputs.evaluateAll((els) =>
      els.findIndex((el) => !(el as HTMLInputElement).value)
    );
    if (emptyIndex === -1) return filled;

    // Re-resolve immediately before typing to keep the window as small as
    // possible, and tolerate the row vanishing between resolve and fill —
    // the next pass simply re-reads whatever is actually there.
    try {
      await inputs.nth(emptyIndex).fill(addressFor(filled), { timeout: 5_000 });
      filled++;
    } catch {
      // Row went away mid-fill (re-render). Fall through and re-query.
    }
  }

  throw new Error(
    'Team step still has empty email inputs after 12 passes — the row list never settled'
  );
}
