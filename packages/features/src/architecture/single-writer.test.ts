import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * ARCHITECTURE TEST — "one writer per domain table".
 *
 * A `db.insert(<domainTable>)` / `db.update(<domainTable>)` may only appear
 * inside that table's OWNING feature directory. Every raw insert/update that
 * happens OUTSIDE the owning service skips the business rules that service runs
 * (dedupe, consent derivation, colour assignment, default shifts, deposit
 * bookkeeping, …). The audit that motivated this test found create-appointment
 * had 8 writers (3 raw) and create-lead had 14 (6 raw).
 *
 * HOW IT WORKS
 * ------------
 * We statically scan `packages/features/src` and `apps/api/src` for
 * `.insert(<table>)` / `.update(<table>)` calls against a fixed set of core
 * domain tables, and assert that each write lives inside the table's owning
 * directory — EXCEPT for a baselined allowlist (the RATCHET) of the raw writers
 * that exist today.
 *
 * THE RATCHET
 * -----------
 * `KNOWN_VIOLATIONS` is the burn-down list. It may only ever SHRINK:
 *   - Adding a NEW raw writer outside the owner dir → test FAILS (add the write
 *     to the owning service instead of baselining it).
 *   - Fixing a raw writer but forgetting to delete its baseline entry → test
 *     FAILS (stale baseline), forcing the list to shrink so the fix can't
 *     silently regress later.
 *
 * DO NOT add entries to `KNOWN_VIOLATIONS` to make a new violation pass. The
 * whole point is that the number only goes down.
 *
 * EXCLUSIONS
 * ----------
 * Seeds, test/spec files, mocks, and the integration test harness legitimately
 * bulk-insert rows to set up fixtures — they are NOT product write paths, so
 * they are excluded from the rule entirely (see EXCLUDED_PATH_SEGMENTS below).
 */

const REPO_ROOT = path.resolve(__dirname, '../../../../');

const SCAN_ROOTS = [
  path.join(REPO_ROOT, 'packages/features/src'),
  path.join(REPO_ROOT, 'apps/api/src'),
];

/**
 * Path fragments that opt a file OUT of the rule. These legitimately bulk-insert
 * rows and are not product write paths:
 *   - test / spec files
 *   - `**​/seeds/**` and `seed-*.ts`             (DB seeding)
 *   - `**​/_integration/**`                       (Testcontainers harness + int-specs)
 *   - `**​/__mocks__/**`                          (vitest boundary mocks)
 */
const EXCLUDED_PATH_SEGMENTS = [
  '.test.ts',
  '.spec.ts',
  '/seeds/',
  '/_integration/',
  '/__mocks__/',
];
const EXCLUDED_BASENAME_PREFIXES = ['seed-'];

/**
 * Core domain tables → the feature directory that OWNS writes to them.
 * Owner dirs are matched as path substrings (the feature root), so a write from
 * that feature's `services/` OR `utils/` counts as "in-owner".
 */
const TABLE_OWNERS: Record<string, string> = {
  // appointments
  appointment: '/features/src/appointments/',
  // leads
  lead: '/features/src/leads/',
  // sales (sale + line items + payments)
  sale: '/features/src/sales/',
  saleItem: '/features/src/sales/',
  salePayment: '/features/src/sales/',
  // gift cards
  giftCard: '/features/src/gift-cards/',
  giftCardTransaction: '/features/src/gift-cards/',
  // memberships (plans + junction + customer memberships)
  membershipPlan: '/features/src/memberships/',
  membershipPlanService: '/features/src/memberships/',
  leadMembership: '/features/src/memberships/',
  // practitioners
  practitioner: '/features/src/practitioners/',
  // scheduling (shifts + blocked time)
  shift: '/features/src/scheduling/',
  blockedTime: '/features/src/scheduling/',
  // conversations
  conversationMessage: '/features/src/conversations/',
  // catalog services
  organizationService: '/features/src/organization-services/',
  // marketing campaigns
  campaign: '/features/src/campaigns/',
  campaignRecipient: '/features/src/campaigns/',
  campaignMessage: '/features/src/campaigns/',
};

/**
 * RATCHET BASELINE — raw writers that exist TODAY, keyed as `<table>::<repo-relative-path>`.
 * This is the burn-down worklist. It may only shrink. See header for the rules.
 *
 * Grouped by table for readability.
 */
const KNOWN_VIOLATIONS: ReadonlySet<string> = new Set([
  // ── appointment (owner: appointments/) ──────────────────────────────────
  'appointment::packages/features/src/booking-forms/services/submit-general-booking/submit-general-booking.service.ts',
  'appointment::packages/features/src/calendar/services/book-appointment/book-appointment.service.ts',
  'appointment::packages/features/src/calendar/services/sync-calendar-events/sync-calendar-events.service.ts',
  'appointment::packages/features/src/calendar/services/sync-to-calendar/sync-to-calendar.service.ts',
  'appointment::packages/features/src/shared/core/soft-delete.ts',

  // ── lead (owner: leads/) ────────────────────────────────────────────────
  'lead::packages/features/src/booking-forms/services/submit-general-booking/submit-general-booking.service.ts',
  'lead::packages/features/src/campaigns/services/handle-sms-webhook/handle-sms-webhook.service.ts',
  'lead::packages/features/src/campaigns/services/send-campaign-message/send-campaign-message.service.ts',
  'lead::packages/features/src/chatbots/services/direct-booking/book-direct-appointment.ts',
  'lead::packages/features/src/conversations/services/handle-incoming-message/create-conversation-lead.ts',
  'lead::packages/features/src/sequences/services/sequence-executor/sequence-executor.service.ts',
  'lead::packages/features/src/shared/core/soft-delete.ts',
  'lead::packages/features/src/voice/services/handle-voice-tool-call/handle-voice-tool-call.service.ts',
  'lead::packages/features/src/voice/services/handle-voice-webhook/handle-voice-webhook.service.ts',

  // ── giftCard / giftCardTransaction (owner: gift-cards/) ─────────────────
  // Sales issues + redeems gift cards inline instead of going through the
  // gift-cards service.
  'giftCard::packages/features/src/sales/services/add-sale-payment/add-sale-payment.service.ts',
  'giftCardTransaction::packages/features/src/sales/services/add-sale-payment/add-sale-payment.service.ts',
  'giftCard::packages/features/src/sales/services/complete-sale/complete-sale.service.ts',
  'giftCardTransaction::packages/features/src/sales/services/complete-sale/complete-sale.service.ts',

  // ── practitioner (owner: practitioners/) ────────────────────────────────
  'practitioner::packages/features/src/integrations/services/import-external-team-members/import-external-team-members.service.ts',
  'practitioner::packages/features/src/organizations/services/accept-invitation/accept-invitation.service.ts',
  'practitioner::packages/features/src/shared/core/soft-delete.ts',

  // ── conversationMessage (owner: conversations/) ─────────────────────────
  'conversationMessage::packages/features/src/chatbots/services/execute-flow/deliver-messages.ts',
]);

const TABLE_NAMES = Object.keys(TABLE_OWNERS);
// e.g. /\.(?:insert|update)\((appointment|lead|...)\)/ — matches db.insert(x),
// tx.update(x), etc. Exact table name + closing paren so `appointment` does not
// match `appointmentDeposit`.
const WRITE_RE = new RegExp(
  `\\.(?:insert|update)\\((${TABLE_NAMES.join('|')})\\)`,
  'g'
);

function isExcluded(absPath: string): boolean {
  const normalized = absPath.replaceAll(path.sep, '/');
  if (EXCLUDED_PATH_SEGMENTS.some((seg) => normalized.includes(seg))) {
    return true;
  }
  const base = path.basename(normalized);
  return EXCLUDED_BASENAME_PREFIXES.some((prefix) => base.startsWith(prefix));
}

function collectTsFiles(dir: string, acc: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      collectTsFiles(full, acc);
    } else if (entry.endsWith('.ts') && !isExcluded(full)) {
      acc.push(full);
    }
  }
}

/** Every raw write outside its owner dir, as `<table>::<repo-relative-path>`. */
function findViolations(): Set<string> {
  const files: string[] = [];
  for (const root of SCAN_ROOTS) collectTsFiles(root, files);

  const violations = new Set<string>();
  for (const file of files) {
    const normalized = file.replaceAll(path.sep, '/');
    const content = readFileSync(file, 'utf8');
    WRITE_RE.lastIndex = 0;
    let match: RegExpExecArray | null = WRITE_RE.exec(content);
    while (match !== null) {
      const table = match[1];
      const owner = TABLE_OWNERS[table];
      if (!normalized.includes(owner)) {
        const relPath = path
          .relative(REPO_ROOT, file)
          .replaceAll(path.sep, '/');
        violations.add(`${table}::${relPath}`);
      }
      match = WRITE_RE.exec(content);
    }
  }
  return violations;
}

describe('architecture: one writer per domain table', () => {
  const violations = findViolations();

  it('has no raw domain-table writers outside the owning feature (except the baseline)', () => {
    const newViolations = [...violations]
      .filter((v) => !KNOWN_VIOLATIONS.has(v))
      .sort();

    expect(
      newViolations,
      `New raw domain-table write(s) found OUTSIDE the owning feature dir.\nRoute the write through the owning service instead of writing the\ntable directly (it skips dedupe / consent / colour / deposit logic).\nOwning dirs: ${JSON.stringify(TABLE_OWNERS, null, 2)}\nOffenders:\n  ${newViolations.join('\n  ')}`
    ).toEqual([]);
  });

  it('has no stale baseline entries (the ratchet may only shrink)', () => {
    const stale = [...KNOWN_VIOLATIONS]
      .filter((v) => !violations.has(v))
      .sort();

    expect(
      stale,
      `These baseline entries are no longer raw writers — the single-writer\nrefactor is done. Delete them from KNOWN_VIOLATIONS so they can never\nregress:\n  ${stale.join('\n  ')}`
    ).toEqual([]);
  });
});
