/**
 * Batch C — draft-ad state persistence ACROSS requests (real DB).
 *
 * `updateDraftAd` is the mutation path Window-6's `set_pending_ad_*` tools use.
 * This is the WIRED, live path that delivers the guided ad-build stories 13–19
 * + 84 (the standalone `claire_setPendingAd*` builder tools are not wired into
 * any skill — see docs/testing/claire-flow-coverage-matrix.md Findings). Field
 * homes, so we test only what actually persists on the ad row:
 *   - copy overrides (headline/primaryText/description) — stories 13/14 — ad row
 *   - targeting override (jsonb MetaTargeting)            — story 16   — ad row
 *   - creative (videoId)                                  — story 15   — covered
 *       by the flagship E2E (real rendered video), not here (FK to a video row)
 *   - budget                                              — story 17   — lives on
 *       the CAMPAIGN, not the ad row — out of scope for updateDraftAd
 *   - intro price ("Just €X")                             — story 18   — baked
 *       into copy, not a column — out of scope
 *
 * The persistence facts a mocked db cannot prove:
 *   - mutations ACCUMULATE on the same draft row across separate calls
 *     (story 84: set headline, then set serviceIds — both survive)
 *   - copy + targeting overrides set across separate turns all coexist
 *     (stories 13/14/16 — the guided build) and the targeting jsonb round-trips
 *   - the `meta_ad_service` junction is fully REWRITTEN when serviceIds change
 *     across two calls, with NO orphan rows left behind
 *   - updateDraftAd on a non-draft (status != 'draft') row is rejected
 *
 * We seed a draft `metaAd` row directly (status defaults to 'draft') plus the
 * org services it references, and call `updateDraftAd` with cascadeDefaults
 * false — that exercises the pure persistence path without needing a full
 * ranked business profile.
 */
import { randomUUID } from 'node:crypto';
import {
  db,
  metaAd,
  metaAdService,
  organization,
  organizationService,
} from '@borradh-workspace/database';
import { updateDraftAd } from '@borradh-workspace/features/claire';
import { and, eq } from 'drizzle-orm';

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

async function seedOrgService(organizationId: string): Promise<string> {
  const id = `svc_${randomUUID()}`;
  await db.insert(organizationService).values({
    id,
    organizationId,
    name: `Service ${id}`,
  });
  return id;
}

async function seedDraftAd(
  organizationId: string,
  status: 'draft' | 'pending' = 'draft'
): Promise<string> {
  const id = `ad_${randomUUID()}`;
  await db.insert(metaAd).values({
    id,
    organizationId,
    name: 'Initial Draft Ad',
    status,
  });
  return id;
}

async function junctionServiceIds(adId: string): Promise<string[]> {
  const rows = await db
    .select({ serviceId: metaAdService.serviceId })
    .from(metaAdService)
    .where(eq(metaAdService.metaAdId, adId));
  return rows.map((r) => r.serviceId).sort();
}

describe('Batch C — draft-ad persistence across requests (real DB)', () => {
  it('accumulates scalar mutations across separate update calls', async () => {
    const organizationId = await seedOrg();
    const draftId = await seedDraftAd(organizationId);

    // Call 1: set the headline.
    const r1 = await updateDraftAd(db, {
      organizationId,
      draftId,
      update: { headline: 'Summer Special' },
    });
    expect(r1.success).toBe(true);

    // Call 2: set the primaryText (headline NOT re-sent).
    const r2 = await updateDraftAd(db, {
      organizationId,
      draftId,
      update: { primaryText: 'Book now and save.' },
    });
    expect(r2.success).toBe(true);

    // Re-read the row: both mutations survived on the same draft.
    const row = await db.query.metaAd.findFirst({
      where: eq(metaAd.id, draftId),
    });
    expect(row?.headline).toBe('Summer Special');
    expect(row?.primaryText).toBe('Book now and save.');
    expect(row?.name).toBe('Initial Draft Ad'); // untouched fields persist
  });

  it('accumulates copy + targeting overrides set across separate turns (stories 13/14/16, 84)', async () => {
    const organizationId = await seedOrg();
    const draftId = await seedDraftAd(organizationId);

    const targeting = {
      location: 'Dublin',
      distanceKm: 20,
      ageMin: 25,
      ageMax: 45,
      genders: [2],
    };

    // Turn 1: headline (stories 13/14). cascadeDefaults stays false so the
    // override sticks rather than being recomputed from a ranked service.
    expect(
      (
        await updateDraftAd(db, {
          organizationId,
          draftId,
          update: { headline: 'Glow this summer' },
        })
      ).success
    ).toBe(true);

    // Turn 2: primaryText — does NOT re-send the headline.
    expect(
      (
        await updateDraftAd(db, {
          organizationId,
          draftId,
          update: { primaryText: 'Book your lip filler today.' },
        })
      ).success
    ).toBe(true);

    // Turn 3: targeting override (story 16) — sends neither copy field.
    expect(
      (
        await updateDraftAd(db, {
          organizationId,
          draftId,
          update: { targetingOverride: targeting },
        })
      ).success
    ).toBe(true);

    // Turn 4: short description (≤30 chars) — sends none of the above.
    expect(
      (
        await updateDraftAd(db, {
          organizationId,
          draftId,
          update: { description: 'Limited summer slots' },
        })
      ).success
    ).toBe(true);

    // Re-read: every field set across the four turns coexists on the row.
    const row = await db.query.metaAd.findFirst({
      where: eq(metaAd.id, draftId),
    });
    expect(row?.headline).toBe('Glow this summer');
    expect(row?.primaryText).toBe('Book your lip filler today.');
    expect(row?.description).toBe('Limited summer slots');
    expect(row?.name).toBe('Initial Draft Ad'); // untouched

    // Targeting jsonb round-trips intact (story 16).
    expect(row?.targetingOverride).toEqual(targeting);
  });

  it('rewrites the meta_ad_service junction across two serviceIds updates (no orphans)', async () => {
    const organizationId = await seedOrg();
    const draftId = await seedDraftAd(organizationId);
    const svcA = await seedOrgService(organizationId);
    const svcB = await seedOrgService(organizationId);
    const svcC = await seedOrgService(organizationId);

    // Call 1: link [A, B].
    const r1 = await updateDraftAd(db, {
      organizationId,
      draftId,
      update: { serviceIds: [svcA, svcB] },
    });
    expect(r1.success).toBe(true);
    if (r1.success) {
      expect([...r1.data.serviceIds].sort()).toEqual([svcA, svcB].sort());
    }
    expect(await junctionServiceIds(draftId)).toEqual([svcA, svcB].sort());

    // Call 2: replace with [C] — A and B must be gone, only C remains.
    const r2 = await updateDraftAd(db, {
      organizationId,
      draftId,
      update: { serviceIds: [svcC] },
    });
    expect(r2.success).toBe(true);
    if (r2.success) expect(r2.data.serviceIds).toEqual([svcC]);

    // The junction is fully rewritten — exactly one row, no A/B orphans.
    expect(await junctionServiceIds(draftId)).toEqual([svcC]);
  });

  it('preserves the junction when an update does not touch serviceIds', async () => {
    const organizationId = await seedOrg();
    const draftId = await seedDraftAd(organizationId);
    const svcA = await seedOrgService(organizationId);

    await updateDraftAd(db, {
      organizationId,
      draftId,
      update: { serviceIds: [svcA] },
    });
    // Scalar-only update — junction should be left intact.
    const r = await updateDraftAd(db, {
      organizationId,
      draftId,
      update: { headline: 'Unchanged services' },
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.serviceIds).toEqual([svcA]);
    expect(await junctionServiceIds(draftId)).toEqual([svcA]);
  });

  it('rejects updateDraftAd on a non-draft (status != draft) row', async () => {
    const organizationId = await seedOrg();
    const promotedId = await seedDraftAd(organizationId, 'pending');

    const r = await updateDraftAd(db, {
      organizationId,
      draftId: promotedId,
      update: { headline: 'should not apply' },
    });
    expect(r.success).toBe(false);

    // Row is untouched.
    const row = await db.query.metaAd.findFirst({
      where: and(
        eq(metaAd.id, promotedId),
        eq(metaAd.organizationId, organizationId)
      ),
    });
    expect(row?.headline).toBeNull();
  });
});
