import { readFileSync, readdirSync } from 'node:fs';

import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The gate on the unified list page.
 *
 * Every record list renders from `components/app/list-page`. Anything else
 * importing `@/components/ui/table` directly is either awaiting migration (a
 * RATCHET that may only shrink) or permanently exempt WITH A WRITTEN REASON.
 *
 * Without this, the twelve hand-rolled tables this component replaced come back
 * one page at a time — which is how they happened the first time. The rule is
 * mechanical and derived from the source, not a convention people remember.
 *
 * Sibling of `features/entity-editors/entity-editor-coverage.test.ts`.
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const srcRoot = resolve(appRoot, 'src');

/** The shared implementation itself — the one legitimate direct consumer. */
const SHARED_IMPLEMENTATION = 'src/components/app/list-page/data-table.tsx';

/**
 * NOT record lists. These render a table of something other than "the rows of
 * this page", so the list shell would be the wrong shape. Permanent, and each
 * needs a reason a human reads in review.
 */
const NOT_A_LIST_PAGE: Record<string, string> = {
  'src/components/app/org-settings/tabs/members.tsx':
    'A table inside the org-settings DIALOG, not a page. It has no page header, no search and no primary action for the shell to own.',
  'src/components/app/user-settings/tabs/teams.tsx':
    'A table inside the user-settings DIALOG, not a page. Same shape as the org-settings members tab.',
  'src/features/wireframes/admin/wf-reports.tsx':
    'Aggregate report tables — revenue by treatment, spend by campaign. The rows are computed figures, not records, so there is nothing to open and no primary action for the shell to own.',
  'src/features/wireframes/growth/retention.tsx':
    'A dashboard of several small segment tables (lapsing, due for rebooking) on one page. No single one of them is "the rows of this page".',
  'src/features/wireframes/admin/wf-data-privacy.tsx':
    'A table of data CATEGORIES and what happens to each on erasure — "Contents / What is happening". Not a list of records.',
  'src/features/wireframes/growth/reviews.tsx':
    'The page opens on one card per unhappy patient; the table is a panel inside a secondary "all responses" view, beside a rating distribution. The cards are the page, not the table.',
  'src/features/wireframes/admin/wf-search.tsx':
    'Two things, neither a record list page: the Cmd-K palette, which is an overlay over whatever you were looking at, and the advanced filter page, whose table is a preview of a query result you export rather than a browsable list.',
  'src/features/admin-terminal/components/audit-log-table.tsx':
    'Internal operations console, not a customer surface. It is deliberately dense and deliberately not held to the product design system.',
  'src/features/admin-terminal/components/organization-detail.tsx':
    'Internal operations console — see audit-log-table.',
  'src/features/admin-terminal/components/organizations-table.tsx':
    'Internal operations console — see audit-log-table.',
  'src/features/inventory/components/stock-order-detail-dialog.tsx':
    'The line-item table INSIDE a stock order, rendered in a dialog. It edits the rows of one record rather than listing records.',
  'src/features/inventory/components/stock-take-count-dialog.tsx':
    'The counting sheet inside one stocktake — an editable grid of one record, not a list of records.',
  'src/features/patient-profile/components/patient-bookings-tab.tsx':
    'A table inside one client’s profile tab. It lists that record’s history, not a page of records.',
  'src/features/patient-profile/components/patient-documents-tab.tsx':
    'A table inside one client’s profile tab — see patient-bookings-tab.',
  'src/features/patient-profile/components/patient-forms-tab.tsx':
    'A table inside one client’s profile tab — see patient-bookings-tab.',
  'src/routes/_authed/dashboard/l/$locationId/sales/daily-summary.tsx':
    'Two SUMMARY tables (transaction totals, cash movement) — aggregates with no rows to click through to, so there is no record list for the shell to render.',
};

/**
 * Record lists still hand-rolling a table. RATCHET: this list may only SHRINK.
 * Never add an entry — migrate the page to `ListPage` instead.
 */
const AWAITING_MIGRATION: string[] = [];

/**
 * RATCHET. Lower this as pages migrate; NEVER raise it. Raising it means a page
 * grew a hand-rolled table instead of using the shared one.
 *
 * Zero: every record list now renders from `ListPage`.
 */
const BASELINE_AWAITING = 0;

function findTableConsumers(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      findTableConsumers(full, acc);
      continue;
    }
    if (!(entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) continue;
    if (entry.name.includes('.test.')) continue;
    const source = readFileSync(full, 'utf8');
    if (source.includes('@/components/ui/table')) {
      acc.push(relative(appRoot, full).split(sep).join('/'));
    }
  }
  return acc;
}

describe('list page coverage', () => {
  const consumers = findTableConsumers(srcRoot);

  it('finds the table consumers (the gate must not pass vacuously)', () => {
    expect(
      consumers.length,
      'Found no files importing @/components/ui/table at all — the scan is ' +
        'broken, so every assertion below would pass trivially.'
    ).toBeGreaterThan(5);
    expect(consumers).toContain(SHARED_IMPLEMENTATION);
  });

  it('every hand-rolled table is migrating or has a written exemption', () => {
    const known = new Set([
      SHARED_IMPLEMENTATION,
      ...AWAITING_MIGRATION,
      ...Object.keys(NOT_A_LIST_PAGE),
    ]);
    const unaccounted = consumers.filter((file) => !known.has(file));

    expect(
      unaccounted,
      `These files render a table directly instead of using ListPage (components/app/list-page). Migrate them, or — if they are not record lists — add a NOT_A_LIST_PAGE entry with a reason:\n${unaccounted.map((file) => `  - ${file}`).join('\n')}`
    ).toEqual([]);
  });

  it('migration only progresses (lower BASELINE_AWAITING, never raise it)', () => {
    expect(
      AWAITING_MIGRATION.length,
      `${AWAITING_MIGRATION.length} pages await migration but the ratchet expects at most ${BASELINE_AWAITING}. A page grew a hand-rolled table. Use ListPage — do not raise the baseline.`
    ).toBeLessThanOrEqual(BASELINE_AWAITING);
  });

  it('has no stale entries (every listed file still renders a table)', () => {
    const current = new Set(consumers);
    const stale = [
      ...AWAITING_MIGRATION,
      ...Object.keys(NOT_A_LIST_PAGE),
    ].filter((file) => !current.has(file));

    expect(
      stale,
      `These files no longer import ui/table — they were migrated or deleted. Remove them from AWAITING_MIGRATION / NOT_A_LIST_PAGE and lower BASELINE_AWAITING:\n${stale.map((file) => `  - ${file}`).join('\n')}`
    ).toEqual([]);
  });

  it('gives every exemption a real reason', () => {
    for (const [file, reason] of Object.entries(NOT_A_LIST_PAGE)) {
      expect(reason.length, `${file} needs a real reason`).toBeGreaterThan(40);
    }
  });
});
