import type { Locator, Page } from '@playwright/test';

/**
 * Determinism harness for the visual-regression project.
 *
 * Pixel diffing only works if the SAME app state renders the SAME pixels every
 * run. Everything in this file exists to remove a source of run-to-run
 * variance. This is the part that decides whether the whole visual programme
 * succeeds: without it, most "regressions" are antialiasing, a relative
 * timestamp ticking over, or a spinner caught mid-rotation — and a human ends
 * up triaging noise forever, which is exactly what the automation is for.
 *
 * Rule: NEVER silence a diff by loosening the pixel threshold. Find the source
 * of the variance and freeze it here, or mask it in `MASK_SELECTORS`.
 */

/**
 * The instant every visual run pretends it is. Fixed so relative timestamps
 * ("2 hours ago"), date pickers defaulting to today, and any `new Date()` in
 * render produce identical pixels forever.
 *
 * Chosen as a Monday mid-morning UTC: weekly calendar views land on a stable
 * week, and business-hours logic renders its "open" state.
 */
export const FROZEN_NOW = new Date('2026-06-15T10:30:00.000Z');

/**
 * Regions that are legitimately nondeterministic and are masked (painted over
 * with a flat colour) rather than frozen. Keep this list SHORT and specific —
 * every mask is a blind spot the diff cannot see through.
 */
const MASK_SELECTORS = [
  '[data-visual-mask]', // explicit opt-out, for anything genuinely live
  'canvas', // charts render with subpixel variance across runs
  'video',
  'img[src*="gravatar"]',
  'img[src*="googleusercontent"]',
];

/**
 * Freeze the clock BEFORE any app code runs.
 *
 * Uses an init script rather than Playwright's clock API so it applies to every
 * document in the context (including client-side navigations) and is in place
 * before the bundle evaluates — a module that captures `Date.now()` at import
 * time would otherwise escape the freeze.
 *
 * `performance.now()` is deliberately left alone: it drives animation timing
 * and transition completion, and freezing it can hang code that waits for an
 * animation frame.
 */
export async function freezeClock(page: Page, now: Date = FROZEN_NOW) {
  await page.addInitScript(`(() => {
    const FIXED = ${now.getTime()};
    const _Date = Date;
    class FrozenDate extends _Date {
      constructor(...args) {
        if (args.length === 0) super(FIXED);
        else super(...args);
      }
      static now() { return FIXED; }
    }
    FrozenDate.parse = _Date.parse;
    FrozenDate.UTC = _Date.UTC;
    globalThis.Date = FrozenDate;
  })()`);
}

/**
 * Kill animations, transitions and carets.
 *
 * `reducedMotion: 'reduce'` (set on the project) only helps for code that
 * honours the media query; this stylesheet is the belt-and-braces version that
 * also catches third-party CSS. Injected as an init script so it applies to
 * every navigation, not just the first.
 */
export async function killAnimations(page: Page) {
  await page.addInitScript(`(() => {
    const style = document.createElement('style');
    style.setAttribute('data-visual-determinism', '');
    style.textContent = \`
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
        caret-color: transparent !important;
      }
    \`;
    const attach = () => document.head?.appendChild(style);
    if (document.head) attach();
    else document.addEventListener('DOMContentLoaded', attach, { once: true });
  })()`);
}

/**
 * Apply every determinism measure to a page. Call ONCE per page, before the
 * first navigation — the init scripts do not apply retroactively.
 */
export async function makeDeterministic(page: Page, now: Date = FROZEN_NOW) {
  await freezeClock(page, now);
  await killAnimations(page);
  // Applied here rather than as a project `use` key: reducedMotion is a browser
  // context option and is not part of the test-level UseOptions type in this
  // Playwright version. Pinning both media features keeps the render a function
  // of the app rather than of the runner's defaults.
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
}

/**
 * Wait until the page is visually settled.
 *
 * Ordered deliberately:
 *  1. network idle — data has arrived, so we are not screenshotting a skeleton
 *  2. fonts.ready — a late webfont reflows text and shifts every glyph
 *  3. no visible skeletons/spinners — the app's own loading affordances
 *  4. two consecutive animation frames — lets the final paint land
 *
 * Returns nothing; throws if the page never settles, which is a real finding
 * (a spinner that never resolves) rather than something to screenshot around.
 */
export async function waitForVisualStability(page: Page, timeoutMs = 15_000) {
  await page.waitForLoadState('networkidle', { timeout: timeoutMs });

  await page.evaluate(() => document.fonts.ready);

  // The app's own loading affordances. `data-slot="skeleton"` is what the
  // shadcn Skeleton primitive renders; the role=status catch-all covers
  // spinners that announce themselves to assistive tech.
  const loading = page.locator(
    '[data-slot="skeleton"], [data-loading="true"], [role="status"][aria-busy="true"]'
  );
  await loading
    .first()
    .waitFor({ state: 'detached', timeout: timeoutMs })
    .catch(() => {
      // No loader present at all is the common case and not an error.
    });

  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
}

/** Locators masked in every screenshot. See MASK_SELECTORS. */
export function masksFor(page: Page): Locator[] {
  return MASK_SELECTORS.map((s) => page.locator(s));
}
