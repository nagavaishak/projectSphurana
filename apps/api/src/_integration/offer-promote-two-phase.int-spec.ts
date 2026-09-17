/**
 * Batch D — confirm→execute / publish two-phase THROUGH the DB.
 *
 * The offer promote path is pure DB (no Meta/Redis), so it's the clean
 * two-phase mechanism we can assert end-to-end:
 *   1. Service level: `promoteDraftOffer` flips state draft→active exactly
 *      once; a second promote is rejected (already non-draft).
 *   2. REST level: `OffersController` POST /:id/promote-draft as an admin
 *      flips the seeded draft offer to active in the DB; promoting again
 *      returns an error status.
 *
 * Meta-dependent publish endpoints (launch_ad / publish_post) are NOT covered
 * here — they require Meta + Redis/BullMQ wiring this harness deliberately
 * excludes, so they remain e2e-only. The token-service two-phase (Batch B) is
 * the in-process confirm→execute mechanism those endpoints build on.
 */
import { randomUUID } from 'node:crypto';
import { db, offer, organization } from '@borradh-workspace/database';
import { promoteDraftOffer } from '@borradh-workspace/features/claire';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { OffersController } from '../offers/offers.controller.js';
import {
  type IntegrationApp,
  buildControllerApp,
  seedOrgWithMember,
} from './harness.js';

async function seedOrg(): Promise<string> {
  const organizationId = `org_${randomUUID()}`;
  await db.insert(organization).values({
    id: organizationId,
    name: `Org ${organizationId}`,
    slug: `slug-${organizationId}`,
    businessType: 'other',
  });
  return organizationId;
}

/** Seed a valid DRAFT percentage offer (discountPercent set so promote passes). */
async function seedDraftOffer(organizationId: string): Promise<string> {
  const id = `off_${randomUUID()}`;
  await db.insert(offer).values({
    id,
    organizationId,
    name: 'Draft Promo',
    state: 'draft',
    discountType: 'percentage',
    discountPercent: 25,
  });
  return id;
}

describe('Batch D — offer promote two-phase (real DB)', () => {
  describe('service level: promoteDraftOffer', () => {
    it('flips draft→active exactly once; second promote is rejected', async () => {
      const organizationId = await seedOrg();
      const draftId = await seedDraftOffer(organizationId);

      const first = await promoteDraftOffer(db, { organizationId, draftId });
      expect(first.success).toBe(true);
      if (first.success) expect(first.data.state).toBe('active');

      // Real row is now active.
      const row = await db.query.offer.findFirst({
        where: eq(offer.id, draftId),
      });
      expect(row?.state).toBe('active');

      // Second promote: row is no longer a draft → rejected, state unchanged.
      const second = await promoteDraftOffer(db, { organizationId, draftId });
      expect(second.success).toBe(false);

      const after = await db.query.offer.findFirst({
        where: eq(offer.id, draftId),
      });
      expect(after?.state).toBe('active');
    });

    it('rejects promotion of an offer in another org (scope isolation)', async () => {
      const ownerOrg = await seedOrg();
      const otherOrg = await seedOrg();
      const draftId = await seedDraftOffer(ownerOrg);

      const res = await promoteDraftOffer(db, {
        organizationId: otherOrg,
        draftId,
      });
      expect(res.success).toBe(false); // NOT_FOUND — wrong org scope

      const row = await db.query.offer.findFirst({
        where: eq(offer.id, draftId),
      });
      expect(row?.state).toBe('draft'); // untouched
    });
  });

  describe('REST level: OffersController POST /:id/promote-draft (admin)', () => {
    it('promotes a draft offer to active, then errors on re-promote', async () => {
      const who = await seedOrgWithMember('admin');
      const draftId = await seedDraftOffer(who.organizationId);

      let h: IntegrationApp | undefined;
      try {
        h = await buildControllerApp(OffersController, {
          userId: who.userId,
          organizationId: who.organizationId,
        });

        // Phase 1: promote → success, offer becomes active in the DB.
        const res1 = await request(h.app.getHttpServer()).post(
          `/offers/${draftId}/promote-draft`
        );
        expect(res1.status).not.toBe(403);
        expect([200, 201]).toContain(res1.status);
        expect(res1.body.state).toBe('active');

        const row = await db.query.offer.findFirst({
          where: eq(offer.id, draftId),
        });
        expect(row?.state).toBe('active');

        // Phase 2: re-promote the now-active offer → error (>= 400).
        const res2 = await request(h.app.getHttpServer()).post(
          `/offers/${draftId}/promote-draft`
        );
        expect(res2.status).not.toBe(403);
        expect(res2.status).toBeGreaterThanOrEqual(400);
      } finally {
        await h?.close();
      }
    });
  });
});
