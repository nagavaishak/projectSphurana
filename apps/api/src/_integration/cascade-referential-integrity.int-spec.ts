/**
 * Batch E (part 3) — cascade / referential integrity.
 *
 * Asserts the ACTUAL FK + service-layer behavior (verified against the schema,
 * not assumed):
 *
 *  - `offer_service.service_id`  → organization_service.id  ON DELETE CASCADE
 *  - `meta_ad_service.service_id`→ organization_service.id  ON DELETE CASCADE
 *  - `asset_service.service_id`  → organization_service.id  ON DELETE CASCADE
 *  - `offer_service.offer_id`    → offer.id                 ON DELETE CASCADE
 *  - `meta_ad_service.meta_ad_id`→ meta_ad.id               ON DELETE CASCADE
 *
 * Service-layer behavior (Option B — gate on the live surface):
 *  - `deleteService` BLOCKS (CONFLICT) when the service is linked to an ASSET,
 *    an ACTIVE offer, or a NON-DRAFT (live/launched) ad — the customer-facing /
 *    money commitments.
 *  - It ALLOWS deletion (junction cascades away) when the only links are DRAFT
 *    ads or DRAFT/expired offers — not customer-facing.
 *  - `deleteOffer` cascades its offer_service / offer_location rows (no
 *    orphans).
 *
 * These are driven through the real `db` singleton + feature services.
 */
import { randomUUID } from 'node:crypto';
import {
  appointment,
  asset,
  assetService,
  consentFormSubmission,
  consentFormTemplate,
  db,
  lead,
  metaAd,
  metaAdService,
  offer,
  offerService,
  organizationService,
} from '@borradh-workspace/database';
import { deleteOffer } from '@borradh-workspace/features/offers';
import { deleteService } from '@borradh-workspace/features/organization-services';
import { and, eq } from 'drizzle-orm';
import {
  seedAppointment,
  seedLead,
  seedOrganization,
  seedService,
  seedUser,
} from './harness.js';

/* ---- local seed helpers (kept inside this spec, harness is shared) ------ */

async function seedOffer(
  organizationId: string,
  state: 'active' | 'draft' | 'expired' = 'active'
): Promise<string> {
  const id = `off_${randomUUID()}`;
  await db.insert(offer).values({
    id,
    organizationId,
    name: 'Cascade Offer',
    discountType: 'percentage',
    discountPercent: 10,
    state,
  });
  return id;
}

async function seedMetaAd(
  organizationId: string,
  status: 'draft' | 'active' = 'draft'
): Promise<string> {
  const id = `ad_${randomUUID()}`;
  await db.insert(metaAd).values({
    id,
    organizationId,
    name: 'Cascade Ad',
    status,
  });
  return id;
}

async function seedAsset(
  organizationId: string,
  uploadedById: string
): Promise<string> {
  const id = `ast_${randomUUID()}`;
  await db.insert(asset).values({
    id,
    name: 'Cascade Asset',
    blobUrl: `https://example.com/${id}.mp4`,
    organizationId,
    uploadedById,
  });
  return id;
}

async function linkOfferService(offerId: string, serviceId: string) {
  await db.insert(offerService).values({ offerId, serviceId });
}
async function linkMetaAdService(metaAdId: string, serviceId: string) {
  await db.insert(metaAdService).values({ metaAdId, serviceId });
}
async function linkAssetService(assetId: string, serviceId: string) {
  await db.insert(assetService).values({ assetId, serviceId });
}

describe('Batch E — cascade / referential integrity', () => {
  it('deleting a service linked to a DRAFT meta ad cascades the junction (delete succeeds)', async () => {
    const organizationId = await seedOrganization();
    const serviceId = await seedService({ organizationId });
    const adId = await seedMetaAd(organizationId, 'draft');
    await linkMetaAdService(adId, serviceId);

    // Sanity: junction row exists.
    const before = await db.query.metaAdService.findFirst({
      where: eq(metaAdService.serviceId, serviceId),
    });
    expect(before).toBeTruthy();

    // Draft ad → not customer-facing → deletion allowed, junction cascades.
    const del = await deleteService(db, { id: serviceId, organizationId });
    expect(del.success).toBe(true);

    const svc = await db.query.organizationService.findFirst({
      where: eq(organizationService.id, serviceId),
    });
    expect(svc).toBeUndefined();

    const orphan = await db.query.metaAdService.findFirst({
      where: eq(metaAdService.serviceId, serviceId),
    });
    expect(orphan).toBeUndefined();

    // The ad row itself survives (only the link was removed).
    const ad = await db.query.metaAd.findFirst({ where: eq(metaAd.id, adId) });
    expect(ad).toBeTruthy();
  });

  it('deleting a service linked to a LIVE (non-draft) ad is BLOCKED (CONFLICT)', async () => {
    const organizationId = await seedOrganization();
    const serviceId = await seedService({ organizationId });
    const adId = await seedMetaAd(organizationId, 'active');
    await linkMetaAdService(adId, serviceId);

    const del = await deleteService(db, { id: serviceId, organizationId });
    expect(del.success).toBe(false);
    if (del.success) throw new Error('expected live-ad link to block deletion');
    expect(del.error.code).toBe('CONFLICT');

    // Service untouched, link intact.
    const svc = await db.query.organizationService.findFirst({
      where: eq(organizationService.id, serviceId),
    });
    expect(svc).toBeTruthy();
  });

  it('deleting a service linked to an ACTIVE offer is BLOCKED (CONFLICT)', async () => {
    const organizationId = await seedOrganization();
    const serviceId = await seedService({ organizationId });
    const offerId = await seedOffer(organizationId, 'active');
    await linkOfferService(offerId, serviceId);

    const del = await deleteService(db, { id: serviceId, organizationId });
    expect(del.success).toBe(false);
    if (del.success)
      throw new Error('expected active-offer link to block deletion');
    expect(del.error.code).toBe('CONFLICT');

    // Service + offer both untouched.
    const svc = await db.query.organizationService.findFirst({
      where: eq(organizationService.id, serviceId),
    });
    expect(svc).toBeTruthy();
    const off = await db.query.offer.findFirst({
      where: eq(offer.id, offerId),
    });
    expect(off).toBeTruthy();
  });

  it('deleting a service linked only to a DRAFT offer cascades the junction (delete succeeds)', async () => {
    const organizationId = await seedOrganization();
    const serviceId = await seedService({ organizationId });
    const offerId = await seedOffer(organizationId, 'draft');
    await linkOfferService(offerId, serviceId);

    const del = await deleteService(db, { id: serviceId, organizationId });
    expect(del.success).toBe(true);

    const orphan = await db.query.offerService.findFirst({
      where: eq(offerService.serviceId, serviceId),
    });
    expect(orphan).toBeUndefined();

    // Draft offer survives (only the link was removed).
    const off = await db.query.offer.findFirst({
      where: eq(offer.id, offerId),
    });
    expect(off).toBeTruthy();
  });

  it('deleting a service linked to an ASSET is BLOCKED (CONFLICT) — the one guarded reference', async () => {
    const organizationId = await seedOrganization();
    const serviceId = await seedService({ organizationId });
    const uploader = await seedUser();
    const assetId = await seedAsset(organizationId, uploader.id);
    await linkAssetService(assetId, serviceId);

    const del = await deleteService(db, { id: serviceId, organizationId });
    expect(del.success).toBe(false);
    if (del.success) throw new Error('expected asset link to block deletion');
    expect(del.error.code).toBe('CONFLICT');

    // Service must still exist (delete was refused).
    const svc = await db.query.organizationService.findFirst({
      where: eq(organizationService.id, serviceId),
    });
    expect(svc).toBeTruthy();
  });

  it('deleting an offer cascade-removes its offer_service junction rows (no orphans)', async () => {
    const organizationId = await seedOrganization();
    const svc1 = await seedService({
      organizationId,
      name: `svc-1-${randomUUID()}`,
    });
    const svc2 = await seedService({
      organizationId,
      name: `svc-2-${randomUUID()}`,
    });
    const offerId = await seedOffer(organizationId);
    await linkOfferService(offerId, svc1);
    await linkOfferService(offerId, svc2);

    const before = await db
      .select()
      .from(offerService)
      .where(eq(offerService.offerId, offerId));
    expect(before).toHaveLength(2);

    const del = await deleteOffer(db, { id: offerId, organizationId });
    expect(del.success).toBe(true);

    const after = await db
      .select()
      .from(offerService)
      .where(eq(offerService.offerId, offerId));
    expect(after).toHaveLength(0);

    // The underlying services are untouched (cascade flows offer → junction only).
    const s1 = await db.query.organizationService.findFirst({
      where: and(
        eq(organizationService.id, svc1),
        eq(organizationService.organizationId, organizationId)
      ),
    });
    expect(s1).toBeTruthy();
  });

  it('deleting a draft meta ad cascade-removes its meta_ad_service junction rows', async () => {
    const organizationId = await seedOrganization();
    const serviceId = await seedService({ organizationId });
    const adId = await seedMetaAd(organizationId);
    await linkMetaAdService(adId, serviceId);

    // No deleteMetaAd feature service is wired into this harness path, so we
    // assert the DB-level FK cascade directly by deleting the ad row.
    await db.delete(metaAd).where(eq(metaAd.id, adId));

    const orphan = await db.query.metaAdService.findFirst({
      where: eq(metaAdService.metaAdId, adId),
    });
    expect(orphan).toBeUndefined();

    // Service survives — cascade flows ad → junction only.
    const svc = await db.query.organizationService.findFirst({
      where: eq(organizationService.id, serviceId),
    });
    expect(svc).toBeTruthy();
  });

  /**
   * ENG-647 — a SIGNED consent form must survive the deletion of the things
   * it hangs off.
   *
   * 0130 made `consent_form_submission.appointment_id` and `.lead_id` ON
   * DELETE CASCADE, so hard-deleting a mis-booked appointment silently
   * destroyed the patient's signed consent for that treatment — no audit row
   * and orphaned S3 objects. The asymmetry gave it away: `template_id` was
   * already RESTRICT, so the blank form was better protected than the
   * signature on it.
   *
   * These assert the FK behaviour directly rather than through
   * `deleteAppointment`, because the service is soft-delete by default and
   * only hard-deletes behind the `killswitch-soft-deletes` flag — the exact
   * path a flag flip makes live.
   */
  describe('ENG-647 — signed consent survives its parents', () => {
    const seedSignedSubmission = async () => {
      const organizationId = await seedOrganization();
      const user = await seedUser();
      const leadId = await seedLead({ organizationId });
      const appointmentId = await seedAppointment({
        organizationId,
        assignedToId: user.id,
        leadId,
      });

      const templateId = `tpl_${randomUUID()}`;
      await db.insert(consentFormTemplate).values({
        id: templateId,
        organizationId,
        title: 'Filler consent',
        body: 'Risks were explained.',
      });

      const submissionId = `sub_${randomUUID()}`;
      await db.insert(consentFormSubmission).values({
        id: submissionId,
        organizationId,
        appointmentId,
        leadId,
        templateId,
        templateSnapshot: {
          title: 'Filler consent',
          body: 'Risks were explained.',
          fields: [],
          requiresSignature: true,
        },
        status: 'completed',
        signedAt: new Date(),
        signedByName: 'Jane Doe',
      });

      return { organizationId, leadId, appointmentId, submissionId };
    };

    it('refuses to delete an appointment holding a signed consent', async () => {
      const { appointmentId, submissionId } = await seedSignedSubmission();

      await expect(
        db.delete(appointment).where(eq(appointment.id, appointmentId))
      ).rejects.toThrow();

      // Still there, still signed.
      const row = await db.query.consentFormSubmission.findFirst({
        where: eq(consentFormSubmission.id, submissionId),
      });
      expect(row?.signedAt).toBeTruthy();
    });

    it('refuses to delete a lead holding a signed consent', async () => {
      const { leadId, submissionId } = await seedSignedSubmission();

      await expect(
        db.delete(lead).where(eq(lead.id, leadId))
      ).rejects.toThrow();

      const row = await db.query.consentFormSubmission.findFirst({
        where: eq(consentFormSubmission.id, submissionId),
      });
      expect(row).toBeTruthy();
    });

    it('allows the delete once the submission is gone', async () => {
      const { appointmentId, submissionId } = await seedSignedSubmission();

      // What `releasePendingConsentForms` does for PENDING rows — proving the
      // constraint blocks the reference, not the delete itself.
      await db
        .delete(consentFormSubmission)
        .where(eq(consentFormSubmission.id, submissionId));
      await db.delete(appointment).where(eq(appointment.id, appointmentId));

      const gone = await db.query.appointment.findFirst({
        where: eq(appointment.id, appointmentId),
      });
      expect(gone).toBeUndefined();
    });
  });
});
