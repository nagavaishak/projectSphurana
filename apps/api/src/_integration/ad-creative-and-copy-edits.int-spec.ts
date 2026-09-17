/**
 * Editing an ad: which edits the server accepts, and what they touch (real DB).
 *
 * The ad side-panel now offers a creative swap behind a pencil, and warns
 * before a save that will pull a LIVE ad back through Meta's review. Both of
 * those are the CLIENT restating rules that live here — and a client that
 * restates a rule wrongly is how an owner meets a 422 they were never warned
 * about, or a warning about something that will not happen.
 *
 * So these tests pin the rules themselves, against a real database:
 *
 *   1. `replaceAdCreative` accepts an unpublished Borradh draft and NOTHING
 *      else — the exact predicate the pencil is gated on
 *      (`status === 'draft' && !metaAdId && !isImported && !useExistingPost`).
 *   2. `updateAd` on an ad with no `metaAdId` persists copy and never reaches
 *      for Meta credentials — the boundary that decides whether a save is
 *      "local edit" or "creative rebuilt on a running ad".
 *   3. A name-only update leaves every creative field untouched, which is what
 *      makes the narrowed payload safe: a rename must not become a re-review.
 *
 * A mocked db proves none of this: the gate is a read of the row as it
 * actually persists, and (1) is a rule about rows that already exist in three
 * different shapes.
 */
import { randomUUID } from 'node:crypto';
import {
  asset,
  db,
  metaAd,
  organization,
  user,
} from '@borradh-workspace/database';
import {
  replaceAdCreative,
  updateAd,
} from '@borradh-workspace/features/meta-ads';
import { eq } from 'drizzle-orm';

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

/** `asset.uploaded_by_id` is NOT NULL, so media needs an uploader. */
async function seedUser(): Promise<string> {
  const id = `user_${randomUUID()}`;
  await db.insert(user).values({
    id,
    name: 'Ad Editor',
    email: `${id}@example.test`,
    emailVerified: true,
  });
  return id;
}

async function seedImageAsset(organizationId: string): Promise<string> {
  const id = `asset_${randomUUID()}`;
  await db.insert(asset).values({
    id,
    organizationId,
    uploadedById: await seedUser(),
    name: `Asset ${id}`,
    blobUrl: `https://cdn.example.test/${id}.jpg`,
    type: 'image',
    source: 'raw',
  });
  return id;
}

interface AdShape {
  status?: 'draft' | 'active' | 'paused' | 'pending' | 'error' | 'rejected';
  metaAdId?: string | null;
  isImported?: boolean;
  useExistingPost?: boolean;
  videoId?: string | null;
}

async function seedAd(
  organizationId: string,
  shape: AdShape = {}
): Promise<string> {
  const id = `ad_${randomUUID()}`;
  await db.insert(metaAd).values({
    id,
    organizationId,
    name: 'Autumn Haircut Promo',
    headline: 'Autumn cuts, booking now',
    primaryText: 'Chairs free this week.',
    status: shape.status ?? 'draft',
    metaAdId: shape.metaAdId ?? null,
    isImported: shape.isImported ?? false,
    useExistingPost: shape.useExistingPost ?? false,
    videoId: shape.videoId ?? null,
  });
  return id;
}

describe('ad creative + copy edits (real DB)', () => {
  describe('replaceAdCreative — the rule the pencil is gated on', () => {
    it('swaps the creative on an unpublished Borradh draft', async () => {
      const organizationId = await seedOrg();
      const oldAsset = await seedImageAsset(organizationId);
      const newAsset = await seedImageAsset(organizationId);
      const adId = await seedAd(organizationId, { videoId: oldAsset });

      const result = await replaceAdCreative(db, {
        adId,
        organizationId,
        videoId: newAsset,
      });

      expect(result.success).toBe(true);
      const row = await db.query.metaAd.findFirst({
        where: eq(metaAd.id, adId),
      });
      expect(row?.videoId).toBe(newAsset);
      expect(row?.graphicId).toBeNull();
    });

    // Each of these is a state the panel must NOT offer the picker for. If the
    // service ever accepts one, the pencil's explanation becomes the lie.
    it('refuses an ad that is already on Meta', async () => {
      const organizationId = await seedOrg();
      const newAsset = await seedImageAsset(organizationId);
      const adId = await seedAd(organizationId, {
        status: 'active',
        metaAdId: '120246528563240037',
      });

      const result = await replaceAdCreative(db, {
        adId,
        organizationId,
        videoId: newAsset,
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.message).toMatch(/unpublished borradh draft/i);
    });

    it('refuses an ad whose publish FAILED (error, no metaAdId)', async () => {
      // The case that motivated gating on `status === 'draft'` rather than on
      // "has no metaAdId": this ad is not on Meta, and still cannot be edited.
      const organizationId = await seedOrg();
      const newAsset = await seedImageAsset(organizationId);
      const adId = await seedAd(organizationId, {
        status: 'error',
        metaAdId: null,
      });

      const result = await replaceAdCreative(db, {
        adId,
        organizationId,
        videoId: newAsset,
      });

      expect(result.success).toBe(false);
    });

    it('refuses an imported ad', async () => {
      const organizationId = await seedOrg();
      const newAsset = await seedImageAsset(organizationId);
      const adId = await seedAd(organizationId, { isImported: true });

      const result = await replaceAdCreative(db, {
        adId,
        organizationId,
        videoId: newAsset,
      });

      expect(result.success).toBe(false);
    });

    it('refuses an existing-post ad', async () => {
      const organizationId = await seedOrg();
      const newAsset = await seedImageAsset(organizationId);
      const adId = await seedAd(organizationId, { useExistingPost: true });

      const result = await replaceAdCreative(db, {
        adId,
        organizationId,
        videoId: newAsset,
      });

      expect(result.success).toBe(false);
    });

    it('refuses media belonging to another org', async () => {
      const organizationId = await seedOrg();
      const otherOrg = await seedOrg();
      const foreignAsset = await seedImageAsset(otherOrg);
      const adId = await seedAd(organizationId);

      const result = await replaceAdCreative(db, {
        adId,
        organizationId,
        videoId: foreignAsset,
      });

      expect(result.success).toBe(false);
      const row = await db.query.metaAd.findFirst({
        where: eq(metaAd.id, adId),
      });
      expect(row?.videoId).toBeNull();
    });

    it('answers NOT FOUND for another org’s ad, without touching it', async () => {
      const owner = await seedOrg();
      const stranger = await seedOrg();
      const newAsset = await seedImageAsset(stranger);
      const adId = await seedAd(owner, { videoId: null });

      const result = await replaceAdCreative(db, {
        adId,
        organizationId: stranger,
        videoId: newAsset,
      });

      expect(result.success).toBe(false);
      const row = await db.query.metaAd.findFirst({
        where: eq(metaAd.id, adId),
      });
      expect(row?.videoId).toBeNull();
    });
  });

  describe('updateAd — what a save actually touches', () => {
    it('persists copy on an ad that is not on Meta, and stops there', async () => {
      // No `metaAdId`, so `updateAdImpl` returns before it asks for Meta
      // credentials — which is why this passes with no Meta integration seeded.
      // That early return IS the definition of "this ad is not live" that the
      // panel and the assistant tool now both use.
      const organizationId = await seedOrg();
      const adId = await seedAd(organizationId, { status: 'draft' });

      const result = await updateAd(db, {
        adId,
        organizationId,
        headline: 'Half-price blow-dry this week',
      });

      expect(result.success).toBe(true);
      const row = await db.query.metaAd.findFirst({
        where: eq(metaAd.id, adId),
      });
      expect(row?.headline).toBe('Half-price blow-dry this week');
      expect(row?.syncError).toBeNull();
    });

    it('leaves every creative field untouched on a name-only update', async () => {
      // The rename regression, at the layer that decides it. The client now
      // sends only what changed; this proves the server's half — a payload
      // carrying just `name` cannot disturb the copy a creative is built from,
      // so a rename has nothing to rebuild.
      const organizationId = await seedOrg();
      const adId = await seedAd(organizationId, { status: 'draft' });

      const before = await db.query.metaAd.findFirst({
        where: eq(metaAd.id, adId),
      });

      const result = await updateAd(db, {
        adId,
        organizationId,
        name: 'Autumn Haircut Promo (Sept)',
      });

      expect(result.success).toBe(true);
      const after = await db.query.metaAd.findFirst({
        where: eq(metaAd.id, adId),
      });
      expect(after?.name).toBe('Autumn Haircut Promo (Sept)');
      expect(after?.headline).toBe(before?.headline);
      expect(after?.primaryText).toBe(before?.primaryText);
      expect(after?.description).toBe(before?.description);
      expect(after?.callToAction).toBe(before?.callToAction);
      expect(after?.destinationUrl).toBe(before?.destinationUrl);
    });

    it('refuses to edit a rejected ad', async () => {
      const organizationId = await seedOrg();
      const adId = await seedAd(organizationId, { status: 'rejected' });

      const result = await updateAd(db, {
        adId,
        organizationId,
        headline: 'Anything',
      });

      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.error.message).toMatch(/rejected/i);
    });

    it('answers NOT FOUND for another org’s ad', async () => {
      const owner = await seedOrg();
      const stranger = await seedOrg();
      const adId = await seedAd(owner);

      const result = await updateAd(db, {
        adId,
        organizationId: stranger,
        headline: 'Not yours',
      });

      expect(result.success).toBe(false);
      const row = await db.query.metaAd.findFirst({
        where: eq(metaAd.id, adId),
      });
      expect(row?.headline).toBe('Autumn cuts, booking now');
    });
  });
});
