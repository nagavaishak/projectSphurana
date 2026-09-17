/**
 * `generateVideoCandidates` — kick off the onboarding video-picker renders.
 *
 * Requires the accepted intro offer (`session.offerId`): the offer video's
 * price card (Was/Now, CTA) is composed from the offer row. This is called
 * right after intro-offer accept so the minutes-scale renders hide behind the
 * ad-picker + campaign-review slides — the service only QUEUES, never waits.
 *
 * Mirrors the offer-format one-prompt create flow (the same chain the videos
 * controller runs for Claire's `createDraftVideo { format: 'offer' }`), built
 * entirely from feature-level services:
 *   1. `getOrgDefaults` + `synthesizeDraftConfig({ format: 'offer' })` — the
 *      base draft from org defaults + template + service signals.
 *   2. `buildOfferCard` — pricing from the offer row + AI benefit copy +
 *      branding. Called PER CANDIDATE so each card gets its own copy roll.
 *   3. Offer reshape — text_only narration, captions off, square canvas,
 *      the offerCard block spread onto the draft (controller parity).
 *   4. B-roll auto-pick (service-linked clips first, library backfill) with
 *      the clip order ROTATED per candidate so the footage varies.
 *   5. `createVideo` + `queueVideoExport` — insert the row, queue the render.
 *
 * Candidate ids land in `session.videoCandidateIds`; the slide polls
 * `GET /videos/:id` per card. Idempotent-ish: an existing healthy candidate
 * set is returned as-is (slide revisit / refresh).
 */

import { randomUUID } from 'node:crypto';
import { onboardingSession, video } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq, inArray } from 'drizzle-orm';
import { listAssets, listAssetsByService } from '../../../assets/index.js';
import { getOrgDefaults } from '../../../org-defaults/index.js';
import { getService } from '../../../organization-services/index.js';
import { getOrganization } from '../../../organizations/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
  sampleVideo,
} from '../../../shared/index.js';
import {
  buildOfferCard,
  createVideo,
  queueVideoExport,
  synthesizeDraftConfig,
} from '../../../videos/index.js';
import {
  type GenerateVideoCandidatesInput,
  type GenerateVideoCandidatesOutput,
  generateVideoCandidatesSchema,
} from './generate-video-candidates.schema.js';

const rewrap = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): FeatureError => new FeatureError(error.code, error.message, error.details);

/** Target b-roll count per candidate (offer template renders fine with few). */
const TARGET_CLIP_COUNT = 3;

/**
 * Minimal feature-level equivalent of the videos controller's private
 * `autoPickClips`: service-linked video assets first, most-recent library
 * assets backfill, de-duped, capped at `targetCount`.
 */
const pickClips = async (
  db: DbConnection,
  organizationId: string,
  serviceId: string | null,
  targetCount: number
): Promise<string[]> => {
  const ordered: string[] = [];
  const seen = new Set<string>();

  if (serviceId) {
    const linked = await listAssetsByService(db, { serviceId, organizationId });
    if (linked.success) {
      for (const a of linked.data) {
        if (a.type !== 'video' || seen.has(a.id)) continue;
        seen.add(a.id);
        ordered.push(a.id);
        if (ordered.length >= targetCount) return ordered;
      }
    }
  }

  const all = await listAssets(db, {
    organizationId,
    type: 'video',
    limit: Math.max(targetCount * 2, 20),
    offset: 0,
  });
  if (all.success) {
    for (const a of all.data.items) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      ordered.push(a.id);
      if (ordered.length >= targetCount) return ordered;
    }
  }

  return ordered;
};

/** Rotate an array by `offset` so each candidate leads with different footage. */
const rotate = <T>(items: T[], offset: number): T[] =>
  items.length === 0
    ? items
    : [
        ...items.slice(offset % items.length),
        ...items.slice(0, offset % items.length),
      ];

/**
 * Dev-only (`ONBOARDING_SAMPLE_ASSETS`): insert `count` ready `video` rows
 * pointing at sample clips and store them on the session — no render jobs.
 * Idempotent: reuses the existing candidate set when it already covers `count`.
 */
const seedSampleVideoCandidates = async (
  db: DbConnection,
  params: {
    userId: string;
    organizationId: string;
    existing: string[];
    count: number;
  }
): Promise<Result<GenerateVideoCandidatesOutput>> => {
  const { userId, organizationId, existing, count } = params;
  if (existing.length >= count) return ok({ videoIds: existing });

  const videoIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    const { blobUrl, thumbnailUrl } = sampleVideo(i);
    await db.insert(video).values({
      id,
      title: `Sample video ${i + 1}`,
      status: 'ready',
      usageType: 'ad',
      organizationId,
      createdById: userId,
      blobUrl,
      thumbnailUrl,
    });
    videoIds.push(id);
  }

  try {
    await db
      .update(onboardingSession)
      .set({ videoCandidateIds: videoIds })
      .where(eq(onboardingSession.userId, userId));
  } catch (error) {
    logError('onboarding.generateVideoCandidates.sampleUpdateSession', error, {
      feature: 'onboarding',
      extra: { userId, videoIds },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to store sample video candidates on the onboarding session'
      )
    );
  }

  return ok({ videoIds });
};

const generateVideoCandidatesImpl = async (
  db: DbConnection,
  input: GenerateVideoCandidatesInput
): Promise<Result<GenerateVideoCandidatesOutput>> => {
  const parsed = generateVideoCandidatesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { userId, count } = parsed.data;

  // ── 1. Load the session + preconditions ──────────────────────────────────
  const session = await db.query.onboardingSession.findFirst({
    where: eq(onboardingSession.userId, userId),
  });
  if (!session) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Onboarding session not found')
    );
  }

  // Dev-only shortcut: skip the render pipeline and seed ready sample videos so
  // the picker fills instantly. Needs only the org (no offer compose).
  if (apiEnv.ONBOARDING_SAMPLE_ASSETS) {
    if (!session.organizationId) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'Onboarding session has no organization yet'
        )
      );
    }
    return seedSampleVideoCandidates(db, {
      userId,
      organizationId: session.organizationId,
      existing: session.videoCandidateIds ?? [],
      count,
    });
  }

  if (!session.organizationId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Onboarding session has no organization yet'
      )
    );
  }
  if (!session.offerId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Accept the intro offer first — offer videos compose their price card from it'
      )
    );
  }
  const organizationId = session.organizationId;
  const offerId = session.offerId;
  const serviceId = session.selectedServiceId ?? null;

  // ── 2. Idempotency: reuse an existing healthy candidate set ─────────────
  const existing = session.videoCandidateIds ?? [];
  if (existing.length > 0) {
    const rows = await db.query.video.findMany({
      where: inArray(video.id, existing),
      columns: { id: true, status: true },
    });
    const healthy =
      rows.length === existing.length &&
      rows.every((r) => r.status !== 'failed');
    if (healthy) {
      return ok({ videoIds: existing });
    }
  }

  // ── 3. Shared synthesis signals ──────────────────────────────────────────
  const defaultsResult = await getOrgDefaults(db, { organizationId });
  if (!defaultsResult.success) {
    return err(rewrap(defaultsResult.error));
  }

  // Best-effort service + org signals (controller parity — never blocks).
  let serviceSignals: {
    id?: string;
    name?: string | null;
    description?: string | null;
  } | null = null;
  if (serviceId) {
    const serviceResult = await getService(db, {
      id: serviceId,
      organizationId,
    });
    if (serviceResult.success) {
      serviceSignals = {
        id: serviceResult.data.id,
        name: serviceResult.data.name,
        description: serviceResult.data.description,
      };
    }
  }
  let orgSignals: { name?: string | null; logoUrl?: string | null } | null =
    null;
  const orgResult = await getOrganization(db, { id: organizationId });
  if (orgResult.success) {
    orgSignals = { name: orgResult.data.name, logoUrl: orgResult.data.logo };
  }

  // B-roll picked ONCE, rotated per candidate so footage order varies.
  const pickedClips = await pickClips(
    db,
    organizationId,
    serviceId,
    TARGET_CLIP_COUNT
  );

  // ── 4. Create + queue `count` offer-video candidates ────────────────────
  // Sequential and transaction-free: buildOfferCard does AI I/O and
  // queueVideoExport does Redis I/O — never hold a DB txn across either.
  const videoIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const synth = synthesizeDraftConfig({
      orgDefaults: defaultsResult.data,
      format: 'offer',
      service: serviceSignals,
      organization: orgSignals,
    });

    // Per-candidate copy roll — each card gets its own headline/bullets.
    const offerCardResult = await buildOfferCard(db, {
      organizationId,
      offerId,
      serviceId: serviceId ?? undefined,
      serviceName: serviceSignals?.name ?? undefined,
      businessName: orgSignals?.name ?? undefined,
    });
    if (!offerCardResult.success) {
      // The card is the offer video's mandatory subject — a failure here
      // would fail every candidate, so abort unless some already queued.
      if (videoIds.length === 0) {
        return err(rewrap(offerCardResult.error));
      }
      break;
    }

    // Offer reshape (controller parity): text_only, captions off, square
    // canvas, offerCard block spread over the synthesized draft.
    synth.draftConfig.narrationType = 'text_only';
    synth.draftConfig.scriptText = undefined;
    synth.draftConfig.textFrames = undefined;
    synth.draftConfig.captions = {
      ...synth.draftConfig.captions,
      enabled: false,
      showBackground: false,
    };
    synth.draftConfig.orientation = 'square';
    Object.assign(synth.draftConfig, offerCardResult.data);

    if (pickedClips.length > 0) {
      synth.draftConfig.bRollClips = rotate(pickedClips, i).map(
        (assetId, order) => ({ assetId, order, clipType: 'bRoll' as const })
      );
    }

    const created = await createVideo(db, {
      title: `${synth.title} — Option ${i + 1}`.slice(0, 100),
      templateId: synth.templateId,
      variationId: synth.variationId,
      serviceId: serviceId ?? undefined,
      offerId,
      draftConfig: synth.draftConfig,
      organizationId,
      createdById: userId,
      usageType: 'ad',
    });
    if (!created.success) {
      logError(
        'onboarding.generateVideoCandidates.create',
        new Error(created.error.message),
        {
          feature: 'onboarding',
          extra: { userId, organizationId, index: i, code: created.error.code },
        }
      );
      continue;
    }

    const queued = await queueVideoExport(db, { id: created.data.id });
    if (!queued.success) {
      logError(
        'onboarding.generateVideoCandidates.queue',
        new Error(queued.error.message),
        {
          feature: 'onboarding',
          extra: { userId, videoId: created.data.id, code: queued.error.code },
        }
      );
      continue;
    }

    videoIds.push(created.data.id);
  }

  if (videoIds.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to queue any video candidates'
      )
    );
  }

  // ── 5. Store the candidate set on the session ────────────────────────────
  try {
    await db
      .update(onboardingSession)
      .set({ videoCandidateIds: videoIds })
      .where(eq(onboardingSession.userId, userId));
  } catch (error) {
    logError('onboarding.generateVideoCandidates.updateSession', error, {
      feature: 'onboarding',
      extra: { userId, videoIds },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to store video candidates on the onboarding session'
      )
    );
  }

  return ok({ videoIds });
};

export const generateVideoCandidates = (
  db: DbConnection,
  input: GenerateVideoCandidatesInput
) =>
  trackedResult(
    'onboarding.generateVideoCandidates',
    () => generateVideoCandidatesImpl(db, input),
    {
      properties: { userId: input.userId, count: input.count },
    }
  );

export type GenerateVideoCandidatesResult = Awaited<
  ReturnType<typeof generateVideoCandidates>
>;
