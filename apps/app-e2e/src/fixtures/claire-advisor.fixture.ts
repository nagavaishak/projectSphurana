import type { Locator, Page } from '@playwright/test';
import { isHiddenWithin, isVisibleWithin } from './wait.js';

/**
 * Claire's field-advisor is a floating chatbox rendered as a Radix-portal
 * dialog with `z-[100001]` (see
 * apps/app/src/features/claire/field-advisor/advisor-card-shell.tsx). When it
 * appears over a step in the new-ad wizard, it intercepts pointer events on
 * the Continue button — Playwright then reports the click target as
 * `[data-claire-chatbox] ... subtree intercepts pointer events`.
 *
 * Call this helper right before any wizard form submit on a Claire-targeted
 * field (e.g. the Services step, ADVISOR_TARGET = 'ads-new-services-list').
 * It's a no-op if the chatbox isn't present, so it's safe to call
 * unconditionally.
 *
 * The X (Dismiss) button only closes the chatbox temporarily — if the
 * underlying state that triggered it (e.g. `context.needsMarketPosition`)
 * is still true, the next context refetch will re-open it. To make the
 * dismissal stick, this helper first tries to resolve the underlying
 * state via the footer controls:
 *   - market-position picker: clicks "I'm not sure"
 *   - "Got it" advance button (tour mode): clicks it
 * Then it falls back to the X button. Finally it waits up to 5s for the
 * chatbox to stay hidden through any re-render churn.
 *
 * We DO NOT disable Claire globally — other specs (assistant.spec.ts,
 * claire-widget.spec.ts) depend on it rendering.
 */
export async function dismissClaireAdvisorIfPresent(
  page: Page
): Promise<boolean> {
  const chatbox = page.locator('[data-claire-chatbox]').first();

  // Fast path: if the chatbox isn't in the DOM at all, Claire never rendered on
  // this step — nothing to dismiss. If it IS mounted, give it a beat to paint
  // (a real wait, not a racing isVisible()).
  if ((await chatbox.count()) === 0) return false;
  if (!(await isVisibleWithin(chatbox, 1_000))) return false;

  // Step 1: try to resolve the underlying state so the chatbox doesn't
  // reopen on the next context poll. Pick "I'm not sure" on the market-
  // position picker, which writes `marketPosition: 'unknown'` and flips
  // `needsMarketPosition` to false.
  const notSureBtn = chatbox.getByRole('button', { name: /^i'm not sure$/i });
  if (await isVisibleWithin(notSureBtn, 1_000)) {
    await notSureBtn.click().catch(() => undefined);
    await chatbox
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => undefined);
  }

  // Step 2: if a tour-mode "Got it" button is showing, advance past it.
  const gotItBtn = chatbox.getByRole('button', { name: /^got it$/i });
  if (await isVisibleWithin(gotItBtn, 1_000)) {
    await gotItBtn.click().catch(() => undefined);
    await chatbox
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => undefined);
  }

  // Step 3: temporary close via the X button if the chatbox is still visible.
  // Loop a few times because the context useEffect may re-open it after a
  // dismissal click while the next poll is in flight.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await isHiddenWithin(chatbox, 500)) return true;
    const dismissBtn = chatbox.locator('button[aria-label="Dismiss"]');
    if (await isVisibleWithin(dismissBtn, 500)) {
      await dismissBtn.click().catch(() => undefined);
    }
    await chatbox
      .waitFor({ state: 'hidden', timeout: 2000 })
      .catch(() => undefined);
  }

  return true;
}

/**
 * Click a button that Claire's advisor may be covering. Tries a normal
 * Playwright click first (so legitimate disabled/not-yet-rendered bugs still
 * surface), but if it times out because the chatbox is intercepting pointer
 * events, falls back to a DOM-level `.click()` evaluation that bypasses the
 * pointer hit test entirely.
 *
 * The fallback dispatches a real `click` event through the button's native
 * `HTMLButtonElement.click()`, which React handles like any other click —
 * so the form submit/handler still fires.
 */
export async function clickThroughClaire(
  page: Page,
  button: Locator
): Promise<void> {
  await dismissClaireAdvisorIfPresent(page);

  try {
    await button.click({ timeout: 5000 });
    return;
  } catch {
    // Fall through to evaluate-click below.
  }

  // Dismiss again in case Claire re-opened during the failed click, then
  // dispatch the click programmatically so pointer-event interception
  // doesn't block us.
  await dismissClaireAdvisorIfPresent(page);
  await button.evaluate((el: HTMLButtonElement) => el.click());
}
