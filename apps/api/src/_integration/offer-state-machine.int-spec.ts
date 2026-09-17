/**
 * Batch E (part 1) — offer state machine & coupon-code integrity.
 *
 * Drives the offers feature services directly against the real test DB (the
 * `db` singleton, pointed at the testcontainers Postgres by global-setup). The
 * cleanest seam for state-machine assertions is the service layer + a re-read,
 * since the transitions live entirely in SQL/Zod, not the HTTP edge.
 *
 * Covers:
 *  - extend: bumping `validUntil` to a later date persists.
 *  - expire: flipping `state` to 'expired' persists and re-reads as expired.
 *  - coupon-code uniqueness: a second offer with the SAME `code` in the same
 *    org is rejected as ALREADY_EXISTS (partial unique index
 *    `idx_offer_org_code_unique`, NOT a 500).
 *  - redemption rules (limitPerClient / redemptionLimit) round-trip.
 */
import { randomUUID } from 'node:crypto';
import { db } from '@borradh-workspace/database';
import {
  createOffer,
  deleteOffer,
  getOffer,
  updateOffer,
} from '@borradh-workspace/features/offers';
import { seedOrganization } from './harness.js';

const uniqueCode = () => `SAVE-${randomUUID().slice(0, 8)}`;

/** A validity date `days` ahead of the real clock — never time-bombs, and
 * always satisfies the Phase 3 backstop (validUntil must be in the future). */
const daysFromNow = (days: number): Date =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

describe('Batch E — offer state machine & coupon integrity', () => {
  it('extend: updating validUntil to a later date persists', async () => {
    const organizationId = await seedOrganization();

    const initial = daysFromNow(30);
    const created = await createOffer(db, {
      organizationId,
      name: 'Extendable Offer',
      discountType: 'percentage',
      discountPercent: 15,
      validUntil: initial,
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error('setup failed');

    const later = daysFromNow(60);
    const updated = await updateOffer(db, {
      id: created.data.id,
      organizationId,
      validUntil: later,
    });
    expect(updated.success).toBe(true);

    const reread = await getOffer(db, { id: created.data.id, organizationId });
    expect(reread.success).toBe(true);
    if (!reread.success) throw new Error('reread failed');
    const { validUntil } = reread.data.offer;
    if (!validUntil) throw new Error('validUntil missing after extend');
    expect(new Date(validUntil).toISOString()).toBe(later.toISOString());
  });

  // Phase 3 (time-correctness) backstop, end-to-end through the service +
  // real DB — the regression that broke the whole offer-create surface when a
  // date-blind model resolved dates against a 2025 prior. A genuinely-future
  // window must be accepted (and echoed back verbatim); a past one must be
  // rejected as VALIDATION_ERROR, never persisted.
  it('accepts a future validity window and rejects a past one (Phase 3 backstop)', async () => {
    const organizationId = await seedOrganization();

    const future = daysFromNow(14);
    const accepted = await createOffer(db, {
      organizationId,
      name: 'Valid two-week offer',
      discountType: 'percentage',
      discountPercent: 20,
      validUntil: future,
    });
    expect(accepted.success).toBe(true);
    if (!accepted.success) throw new Error('future offer should succeed');
    expect(new Date(accepted.data.validUntil as Date).toISOString()).toBe(
      future.toISOString()
    );

    const rejected = await createOffer(db, {
      organizationId,
      name: 'Pre-expired offer',
      discountType: 'percentage',
      discountPercent: 20,
      validUntil: daysFromNow(-30),
    });
    expect(rejected.success).toBe(false);
    if (rejected.success) throw new Error('past offer should be rejected');
    expect(rejected.error.code).toBe('VALIDATION_ERROR');
  });

  it('expire: flipping state to expired persists on re-read', async () => {
    const organizationId = await seedOrganization();

    const created = await createOffer(db, {
      organizationId,
      name: 'Expiring Offer',
      discountType: 'percentage',
      discountPercent: 20,
      // default state is 'active'
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error('setup failed');
    expect(created.data.state).toBe('active');

    const expired = await updateOffer(db, {
      id: created.data.id,
      organizationId,
      state: 'expired',
    });
    expect(expired.success).toBe(true);
    if (!expired.success) throw new Error('expire failed');
    expect(expired.data.state).toBe('expired');

    const reread = await getOffer(db, { id: created.data.id, organizationId });
    expect(reread.success).toBe(true);
    if (!reread.success) throw new Error('reread failed');
    expect(reread.data.offer.state).toBe('expired');
  });

  it('coupon-code uniqueness: duplicate code in same org → ALREADY_EXISTS (not 500)', async () => {
    const organizationId = await seedOrganization();
    const code = uniqueCode();

    const first = await createOffer(db, {
      organizationId,
      name: 'First Coupon',
      code,
      discountType: 'percentage',
      discountPercent: 10,
    });
    expect(first.success).toBe(true);

    const second = await createOffer(db, {
      organizationId,
      name: 'Duplicate Coupon',
      code, // same code, same org
      discountType: 'percentage',
      discountPercent: 25,
    });
    expect(second.success).toBe(false);
    if (second.success) throw new Error('expected duplicate to fail');
    expect(second.error.code).toBe('ALREADY_EXISTS');
  });

  it('coupon-code uniqueness is case-insensitive within an org', async () => {
    const organizationId = await seedOrganization();
    const code = uniqueCode();

    const first = await createOffer(db, {
      organizationId,
      name: 'Lower',
      code: code.toLowerCase(),
      discountType: 'percentage',
      discountPercent: 10,
    });
    expect(first.success).toBe(true);

    const second = await createOffer(db, {
      organizationId,
      name: 'Upper',
      code: code.toUpperCase(),
      discountType: 'percentage',
      discountPercent: 10,
    });
    expect(second.success).toBe(false);
    if (second.success) throw new Error('expected case-insensitive clash');
    expect(second.error.code).toBe('ALREADY_EXISTS');
  });

  it('same coupon code is allowed across DIFFERENT orgs (index is per-org)', async () => {
    const orgA = await seedOrganization();
    const orgB = await seedOrganization();
    const code = uniqueCode();

    const a = await createOffer(db, {
      organizationId: orgA,
      name: 'Org A coupon',
      code,
      discountType: 'percentage',
      discountPercent: 10,
    });
    const b = await createOffer(db, {
      organizationId: orgB,
      name: 'Org B coupon',
      code,
      discountType: 'percentage',
      discountPercent: 10,
    });
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
  });

  it('redemption rules (limitPerClient / redemptionLimit) round-trip on re-read', async () => {
    const organizationId = await seedOrganization();

    const created = await createOffer(db, {
      organizationId,
      name: 'Limited Offer',
      discountType: 'percentage',
      discountPercent: 30,
      limitPerClient: true,
      redemptionLimit: 5,
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error('setup failed');
    expect(created.data.limitPerClient).toBe(true);
    expect(created.data.redemptionLimit).toBe(5);

    const reread = await getOffer(db, { id: created.data.id, organizationId });
    expect(reread.success).toBe(true);
    if (!reread.success) throw new Error('reread failed');
    expect(reread.data.offer.limitPerClient).toBe(true);
    expect(reread.data.offer.redemptionLimit).toBe(5);
    // redemptionCount starts at 0 (DB default).
    expect(reread.data.offer.redemptionCount).toBe(0);
  });

  it('deleting an offer removes it (NOT_FOUND on re-read)', async () => {
    const organizationId = await seedOrganization();
    const created = await createOffer(db, {
      organizationId,
      name: 'Deletable',
      discountType: 'percentage',
      discountPercent: 10,
    });
    expect(created.success).toBe(true);
    if (!created.success) throw new Error('setup failed');

    const del = await deleteOffer(db, { id: created.data.id, organizationId });
    expect(del.success).toBe(true);

    const reread = await getOffer(db, { id: created.data.id, organizationId });
    expect(reread.success).toBe(false);
    if (reread.success) throw new Error('expected NOT_FOUND');
    expect(reread.error.code).toBe('NOT_FOUND');
  });
});
