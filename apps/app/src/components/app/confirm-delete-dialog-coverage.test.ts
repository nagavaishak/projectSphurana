import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The gate on the one destructive confirmation.
 *
 * Every "delete / remove / revoke / permanently discard this" in the app
 * renders from `components/app/confirm-delete-dialog`, so they cannot drift in
 * wording, layout, button order or button colour. Anything else reaching for
 * `@/components/ui/alert-dialog` directly is either NOT a destructive
 * confirmation (permanently exempt, WITH A WRITTEN REASON) or awaiting
 * migration (a RATCHET that may only shrink).
 *
 * `window.confirm` is banned outright. It is an unstyled, unbranded browser
 * dialog that no test can drive and no designer has ever seen — eight of them
 * had accumulated before this component existed.
 *
 * The rule is mechanical and derived from the source, not a convention people
 * remember; that is the only kind that survives. Sibling of
 * `list-page/list-page-coverage.test.ts` and
 * `features/entity-editors/entity-editor-coverage.test.ts`.
 */

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const srcRoot = resolve(appRoot, 'src');

/** The shared implementation itself — the one legitimate direct consumer. */
const SHARED_IMPLEMENTATION = 'src/components/app/confirm-delete-dialog.tsx';

/**
 * NOT destructive. These confirm something the operator can undo, re-do, or
 * live with — publishing, launching, buying, discarding an unsaved draft,
 * overriding a warning. They are deliberately NOT dressed in the destructive
 * red medallion, because crying wolf on a publish button teaches people to
 * click through the real ones. Permanent, and each needs a reason a human
 * reads in review.
 */
const NOT_DESTRUCTIVE: Record<string, string> = {
  'src/features/appointments/create/double-booking-confirm-dialog.tsx':
    'An override, not a deletion: the server refused a double-booking and this asks the operator to book it anyway. Nothing is destroyed — a booking is created.',
  'src/features/resources/booking/appointment-resource-panel-row.tsx':
    'The same override one layer down, for a ROOM rather than a practitioner: `resource_no_overlap` would refuse the write, and this asks the operator to double-book the room anyway. Confirming CREATES an allocation; nothing is removed.',
  'src/features/campaigns/components/campaign-composer.tsx':
    'The "Ready to send?" send-off summary before a campaign goes out. It creates and sends messages; it destroys nothing.',
  'src/features/campaigns/components/campaign-detail.tsx':
    'Launches a campaign to its audience. Irreversible, but additive — it sends messages rather than removing anything.',
  'src/features/campaigns/components/sms-number-card.tsx':
    'Confirms BUYING a phone number on the org’s Twilio account — a purchase with a recurring charge. It needs care, but it is an acquisition, not a deletion.',
  'src/features/socials/components/new-post-dialog.tsx':
    'Discards an UNSAVED draft the user is composing. Nothing that was ever persisted is removed, so the destructive treatment would overstate it.',
  'src/features/website/components/diff-card.tsx':
    'Confirms applying an AI-proposed edit to the website DRAFT. The copy says it explicitly: it stays in the draft until you publish, and version history can undo it.',
  'src/features/website/components/publish-button.tsx':
    'Publishes the draft site to the live site. It replaces what visitors see, but every previous version stays in version history.',
  'src/features/meta-ads/components/ad-side-panel/ad-side-panel.tsx':
    'Two confirmations on the ad editor, neither of which removes anything. One agrees to REPLACE a live ad\u2019s creative — Meta creatives are immutable, so saving copy on a running ad mints a new one and sends the ad back through review; results and spend are kept. The other explains why a published ad\u2019s media cannot be swapped and offers a DUPLICATE, which creates a draft copy.',
  'src/features/website/components/version-history.tsx':
    'Restores an earlier version into the draft. Its own copy is the argument: "Nothing is deleted, and your live site does not change until you publish."',
};

/**
 * Destructive confirmations still hand-assembling their own dialog.
 * RATCHET: this list may only SHRINK. Never add an entry — migrate the caller
 * to `ConfirmDeleteDialog` instead.
 */
const AWAITING_MIGRATION = [
  // Deletes the user's account. It carries a "type DELETE to confirm" input
  // INSIDE the dialog body, and ConfirmDeleteDialog has no slot for extra body
  // content — migrating it needs a `children` (or `confirmationPhrase`) prop on
  // the shared component first.
  'src/components/app/user-settings/tabs/security.tsx',
];

/**
 * RATCHET. Lower this as callers migrate; NEVER raise it. Raising it means a
 * destructive confirmation was hand-assembled instead of using the shared one.
 */
const BASELINE_AWAITING = 1;

interface Scan {
  /** Files importing `@/components/ui/alert-dialog` directly. */
  alertDialog: string[];
  /** Files that call `window.confirm(...)`. */
  windowConfirm: string[];
  /** Every source file the walk considered — proves the walk ran. */
  scanned: number;
}

function scan(dir: string, acc: Scan): Scan {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      scan(full, acc);
      continue;
    }
    if (!(entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))) continue;
    // Test files legitimately reference the primitive to mock it.
    if (entry.name.includes('.test.') || entry.name.includes('.spec.'))
      continue;

    const source = readFileSync(full, 'utf8');
    acc.scanned += 1;
    const path = relative(appRoot, full).split(sep).join('/');
    if (source.includes('@/components/ui/alert-dialog'))
      acc.alertDialog.push(path);
    // The trailing paren matters: prose ABOUT `window.confirm` (this file, and
    // the comments left where one was removed) is not a call site.
    if (source.includes('window.confirm(')) acc.windowConfirm.push(path);
  }
  return acc;
}

describe('confirm delete dialog coverage', () => {
  const found = scan(srcRoot, {
    alertDialog: [],
    windowConfirm: [],
    scanned: 0,
  });

  it('finds the alert-dialog consumers (the gate must not pass vacuously)', () => {
    expect(
      found.scanned,
      'The source walk visited almost no files — the scan is broken, so every ' +
        'assertion below would pass trivially.'
    ).toBeGreaterThan(100);
    expect(
      found.alertDialog.length,
      'Found no files importing @/components/ui/alert-dialog at all, not even ' +
        'the shared component — the scan is broken.'
    ).toBeGreaterThan(3);
    expect(found.alertDialog).toContain(SHARED_IMPLEMENTATION);
  });

  it('every hand-assembled alert dialog is migrating or has a written exemption', () => {
    const known = new Set([
      SHARED_IMPLEMENTATION,
      ...AWAITING_MIGRATION,
      ...Object.keys(NOT_DESTRUCTIVE),
    ]);
    const unaccounted = found.alertDialog.filter((file) => !known.has(file));

    expect(
      unaccounted,
      `These files assemble an AlertDialog directly. If the confirmation is DESTRUCTIVE (delete, remove, revoke, permanently discard), render <ConfirmDeleteDialog> from components/app/confirm-delete-dialog instead. If it is not, add a NOT_DESTRUCTIVE entry saying why:\n${unaccounted.map((file) => `  - ${file}`).join('\n')}`
    ).toEqual([]);
  });

  it('bans window.confirm outright', () => {
    const offenders = found.windowConfirm.filter(
      (file) => !AWAITING_MIGRATION.includes(file)
    );

    expect(
      offenders,
      `window.confirm is an unstyled, unbranded browser dialog that no test can drive and that cannot carry the consequence of the action. Use <ConfirmDeleteDialog> for destructive confirmations, or a Dialog for anything else:\n${offenders.map((file) => `  - ${file}`).join('\n')}`
    ).toEqual([]);
  });

  it('migration only progresses (lower BASELINE_AWAITING, never raise it)', () => {
    expect(
      AWAITING_MIGRATION.length,
      `${AWAITING_MIGRATION.length} callers await migration but the ratchet expects at most ${BASELINE_AWAITING}. A destructive confirmation was hand-assembled. Use ConfirmDeleteDialog — do not raise the baseline.`
    ).toBeLessThanOrEqual(BASELINE_AWAITING);
  });

  it('has no stale entries (every listed file still confirms by hand)', () => {
    const current = new Set([...found.alertDialog, ...found.windowConfirm]);
    const stale = [
      ...AWAITING_MIGRATION,
      ...Object.keys(NOT_DESTRUCTIVE),
    ].filter((file) => !current.has(file));

    expect(
      stale,
      `These files no longer import ui/alert-dialog or call window.confirm — they were migrated or deleted. Remove them from AWAITING_MIGRATION / NOT_DESTRUCTIVE and lower BASELINE_AWAITING:\n${stale.map((file) => `  - ${file}`).join('\n')}`
    ).toEqual([]);
  });

  it('gives every exemption a real reason', () => {
    for (const [file, reason] of Object.entries(NOT_DESTRUCTIVE)) {
      expect(
        reason.length,
        `${file} needs a real reason, not a placeholder`
      ).toBeGreaterThan(40);
    }
  });
});
