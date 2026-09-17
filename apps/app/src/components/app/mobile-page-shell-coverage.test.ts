import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * THE GATE ON THE MOBILE PAGE SHELL.
 *
 * Every mobile page renders through `components/app/mobile-page-shell` —
 * directly, or via `DashboardPage`, which renders it on a phone. That is what
 * gives every screen the same frame: a back control alone in the floating bar,
 * a 32px left-aligned title IN THE PAGE, a fixed toolbar, one scroll region.
 *
 * The mechanical rule is about the TITLE, because the title is where the shells
 * diverged and it is the part a page cannot fake by accident: a page that puts
 * `heading`, `centerTitle` or `compactTitle` into the floating header is
 * drawing its own chrome instead of using the shell's. Before this gate there
 * were fifteen such pages and four different treatments of the same idea —
 * 32px left in a bar, 15px centred in a bar, 24px in the page, and one page
 * with no title at all.
 *
 * Sibling of `list-page/list-page-coverage.test.ts` and
 * `features/entity-editors/entity-editor-coverage.test.ts`: derived from the
 * source, not from a convention people are asked to remember.
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const srcRoot = resolve(appRoot, 'src');

/** The header's own implementation, and the shell that drives it. */
const SHELL_INTERNALS = [
  'src/features/mobile-dashboard-header',
  'src/components/app/mobile-page-shell.tsx',
];

/**
 * Screens whose phone chrome is genuinely a NAVIGATION BAR, not a page title.
 *
 * RATCHET: this map may only SHRINK. Never add an entry — move the page onto
 * `MobilePageShell` instead. Each one needs a reason a human reads in review.
 */
const NOT_A_PAGE_TITLE: Record<string, string> = {
  'src/components/calendar/components/client-container.tsx':
    'The calendar’s bar is a DATE control — it swaps the visible day and carries the view switcher. There is no static page title for the shell to render, and a "Bookings" heading above it would say less than the date already does.',
  'src/features/account/use-account-drill-down-header.ts':
    'Account and org-settings pages render from `PageShell`, which is padding only and has nowhere to put a title. Moving them onto the shell is a real migration of ~10 settings routes, not a header change — until then the header is the only thing naming those screens.',
  'src/features/meta-campaigns/components/campaign-mobile/campaign-mobile-ad-detail.tsx':
    'Full-screen ad wizard step. Its bar is step chrome (back / step name / next), not a page header.',
  'src/features/meta-campaigns/components/campaign-mobile/campaign-mobile-create.tsx':
    'Full-screen campaign wizard — see campaign-mobile-ad-detail.',
  'src/features/services-dashboard/mobile/service-mobile-form-page.tsx':
    'Full-screen service editor — see campaign-mobile-ad-detail.',
  'src/routes/_authed/ads/new/-components/ad-mobile/ad-mobile-video-format-page.tsx':
    'Full-screen ad wizard step — see campaign-mobile-ad-detail.',
  'src/routes/_authed/ads/new/-components/ad-mobile/ad-mobile-wizard.tsx':
    'Full-screen ad wizard — see campaign-mobile-ad-detail.',
  'src/routes/_authed/create-video/$templateId/-components/create-video-mobile-page.tsx':
    'Full-screen video creation flow — see campaign-mobile-ad-detail.',
  'src/routes/_authed/dashboard/l/$locationId/marketing/gallery/new/-components/content-create-mobile-wizard.tsx':
    'Full-screen content wizard — see campaign-mobile-ad-detail.',
  'src/routes/_authed/dashboard/l/$locationId/marketing/socials/new/-components/content-mobile-wizard.tsx':
    'Full-screen content wizard — see campaign-mobile-ad-detail.',
};

/**
 * RATCHET. Lower this as pages migrate; NEVER raise it.
 *
 * Raising it means a page grew its own phone chrome instead of using the shared
 * one — which is how fifteen of them happened the first time.
 */
const BASELINE_EXEMPT = 10;

/** `heading` / `centerTitle` / `compactTitle` published to the floating bar. */
const TITLE_KEY = /\b(heading|centerTitle|compactTitle)\s*:/;

function findHeaderConsumers(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      findHeaderConsumers(full, acc);
      continue;
    }
    if (!(entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) continue;
    if (entry.name.includes('.test.')) continue;

    const source = readFileSync(full, 'utf8');
    if (!source.includes('useMobileDashboardHeaderContent')) continue;
    if (!TITLE_KEY.test(source)) continue;

    acc.push(relative(appRoot, full).split(sep).join('/'));
  }
  return acc;
}

function isShellInternal(file: string): boolean {
  return SHELL_INTERNALS.some(
    (prefix) => file === prefix || file.startsWith(`${prefix}/`)
  );
}

describe('mobile page shell coverage', () => {
  const offenders = findHeaderConsumers(srcRoot).filter(
    (file) => !isShellInternal(file)
  );

  it('no page puts its title in the floating header without an exemption', () => {
    const undeclared = offenders.filter((file) => !(file in NOT_A_PAGE_TITLE));

    expect(
      undeclared,
      [
        'These pages publish a title into the mobile header instead of rendering',
        'it in the page through `MobilePageShell` (or `DashboardPage`, which',
        'renders the shell on a phone):',
        ...undeclared.map((file) => `  - ${file}`),
        '',
        'Use the shell. If the screen genuinely has navigation-bar chrome rather',
        'than a page title, add it to NOT_A_PAGE_TITLE with a written reason and',
        'RAISE BASELINE_EXEMPT — which review should push back on.',
      ].join('\n')
    ).toEqual([]);
  });

  it('the exemption list only shrinks', () => {
    expect(
      offenders.length,
      `Exempt pages: ${offenders.length}, baseline ${BASELINE_EXEMPT}. Lower BASELINE_EXEMPT as pages migrate; never raise it.`
    ).toBeLessThanOrEqual(BASELINE_EXEMPT);
  });

  it('every exemption names a real file', () => {
    const stale = Object.keys(NOT_A_PAGE_TITLE).filter(
      (file) => !offenders.includes(file)
    );

    expect(
      stale,
      `These exemptions are stale — the page no longer sets a header title, so delete the entry: ${stale.join(', ')}`
    ).toEqual([]);
  });

  it('every exemption carries a reason', () => {
    const unreasoned = Object.entries(NOT_A_PAGE_TITLE)
      .filter(([, reason]) => reason.trim().length < 40)
      .map(([file]) => file);

    expect(unreasoned).toEqual([]);
  });
});
