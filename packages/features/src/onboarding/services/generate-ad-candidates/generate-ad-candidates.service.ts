/**
 * `generateAdCandidates` — kick off the onboarding ad-picker grid.
 *
 * Requires the accepted intro offer (`session.offerId`) — the offer-ad
 * template composes its badge / pricing / CTA from the offer row, so the
 * offer must exist before any candidate renders.
 *
 * Reuses `generateGraphicFromService` (the same feature service behind
 * Claire's `createAdGraphic` tool): each call inserts a placeholder `graphic`
 * row (`usageType='ad'`, `status='rendering'`) and enqueues a
 * `graphic-generate` job. Candidates VARY by `topicSummary` angle (the copy
 * writer's steer), and template selection hashes each fresh graphicId, so the
 * grid renders four genuinely different ads. The slide polls
 * `GET /graphics/:id` per card until each flips to ready/failed.
 *
 * Idempotent-ish: when candidates already exist and none failed, the existing
 * ids are returned instead of re-rendering (slide revisit / refresh).
 */

import { randomUUID } from 'node:crypto';
import { graphic, onboardingSession } from '@borradh-workspace/database';
import { apiEnv } from '@borradh-workspace/env/api';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { eq, inArray } from 'drizzle-orm';
import { generateGraphicFromService } from '../../../graphics/index.js';
import { getService } from '../../../organization-services/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
  sampleGraphicOutputs,
} from '../../../shared/index.js';
import {
  type GenerateAdCandidatesInput,
  type GenerateAdCandidatesOutput,
  generateAdCandidatesSchema,
} from './generate-ad-candidates.schema.js';

/**
 * Angle templates the candidates cycle through — one steer per card so the
 * copy writer produces four distinct ads (offer-led, transformation-led,
 * pain-point-led, trust-led) rather than four re-rolls of the same brief.
 */
const CANDIDATE_ANGLES: ReadonlyArray<(serviceName: string) => string> = [
  (s) => `${s} — lead with the new-client intro offer and the price drop`,
  (s) => `${s} — lead with the transformation and the end result`,
  (s) => `${s} — lead with the specific pain point this solves`,
  (s) => `${s} — lead with trust and social proof for first-time clients`,
];

const rewrap = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): FeatureError => new FeatureError(error.code, error.message, error.details);

/**
 * Dev-only (`ONBOARDING_SAMPLE_ASSETS`): insert `count` ready `graphic` rows
 * pointing at sample images and store them on the session — no render jobs.
 * Idempotent: reuses the existing candidate set when it already covers `count`.
 */
const seedSampleAdCandidates = async (
  db: DbConnection,
  params: {
    userId: string;
    organizationId: string;
    existing: string[];
    count: number;
  }
): Promise<Result<GenerateAdCandidatesOutput>> => {
  const { userId, organizationId, existing, count } = params;
  if (existing.length >= count) return ok({ graphicIds: existing });

  const graphicIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = randomUUID();
    await db.insert(graphic).values({
      id,
      title: 'Sample ad',
      status: 'ready',
      usageType: 'ad',
      organizationId,
      outputs: sampleGraphicOutputs(i),
    });
    graphicIds.push(id);
  }

  try {
    await db
      .update(onboardingSession)
      .set({ adCandidateGraphicIds: graphicIds })
      .where(eq(onboardingSession.userId, userId));
  } catch (error) {
    logError('onboarding.generateAdCandidates.sampleUpdateSession', error, {
      feature: 'onboarding',
      extra: { userId, graphicIds },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to store sample ad candidates on the onboarding session'
      )
    );
  }

  return ok({ graphicIds });
};

const generateAdCandidatesImpl = async (
  db: DbConnection,
  input: GenerateAdCandidatesInput
): Promise<Result<GenerateAdCandidatesOutput>> => {
  const parsed = generateAdCandidatesSchema.safeParse(input);
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

  // Dev-only shortcut: skip the render pipeline and seed ready sample ads so
  // the picker fills instantly. Needs only the org (no offer/service compose).
  if (apiEnv.ONBOARDING_SAMPLE_ASSETS) {
    if (!session.organizationId) {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'Onboarding session needs an organization before ad candidates can generate'
        )
      );
    }
    return seedSampleAdCandidates(db, {
      userId,
      organizationId: session.organizationId,
      existing: session.adCandidateGraphicIds ?? [],
      count,
    });
  }

  if (!session.organizationId || !session.selectedServiceId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Onboarding session needs an organization and a selected service before ad candidates can generate'
      )
    );
  }
  if (!session.offerId) {
    return err(
      new FeatureError(
        ErrorCodes.CONFLICT,
        'Accept the intro offer first — ad graphics compose their badge and pricing from it'
      )
    );
  }
  const organizationId = session.organizationId;
  const serviceId = session.selectedServiceId;

  // ── 2. Idempotency: reuse an existing healthy candidate set ─────────────
  const existing = session.adCandidateGraphicIds ?? [];
  if (existing.length > 0) {
    const rows = await db.query.graphic.findMany({
      where: inArray(graphic.id, existing),
      columns: { id: true, status: true },
    });
    const healthy =
      rows.length === existing.length &&
      rows.every((r) => r.status !== 'failed');
    if (healthy) {
      return ok({ graphicIds: existing });
    }
  }

  // ── 3. Resolve the service name for the angle briefs ────────────────────
  const serviceResult = await getService(db, { id: serviceId, organizationId });
  if (!serviceResult.success) {
    return err(rewrap(serviceResult.error));
  }
  const serviceName = serviceResult.data.name;

  // ── 4. Create `count` placeholder graphics + render jobs ────────────────
  // Sequential on purpose: each call is a fast insert + queue.add, and the
  // heavy work happens on the worker. No transaction is held across these.
  const graphicIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const angle = CANDIDATE_ANGLES[i % CANDIDATE_ANGLES.length](serviceName);
    const generated = await generateGraphicFromService(db, {
      organizationId,
      serviceId,
      // Schema defaults, spelled out because the param type is the schema
      // OUTPUT type: 'tips' is ignored for ad usage; never fabricate service
      // imagery with AI when real media exists. Curated stock IS allowed —
      // an org still in onboarding rarely has uploaded media yet, and stock
      // is the intended fallback (the AI tier stays off).
      category: 'tips',
      allowAiImages: false,
      allowStockImages: true,
      usageType: 'ad',
      offerId: session.offerId,
      topicSummary: angle,
    });
    if (!generated.success) {
      logError(
        'onboarding.generateAdCandidates.candidate',
        new Error(generated.error.message),
        {
          feature: 'onboarding',
          extra: {
            userId,
            organizationId,
            index: i,
            code: generated.error.code,
          },
        }
      );
      continue;
    }
    graphicIds.push(generated.data.id);
  }

  if (graphicIds.length === 0) {
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate any ad candidates'
      )
    );
  }

  // ── 5. Store the candidate set on the session ────────────────────────────
  try {
    await db
      .update(onboardingSession)
      .set({ adCandidateGraphicIds: graphicIds })
      .where(eq(onboardingSession.userId, userId));
  } catch (error) {
    logError('onboarding.generateAdCandidates.updateSession', error, {
      feature: 'onboarding',
      extra: { userId, graphicIds },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to store ad candidates on the onboarding session'
      )
    );
  }

  return ok({ graphicIds });
};

export const generateAdCandidates = (
  db: DbConnection,
  input: GenerateAdCandidatesInput
) =>
  trackedResult(
    'onboarding.generateAdCandidates',
    () => generateAdCandidatesImpl(db, input),
    {
      properties: { userId: input.userId, count: input.count },
    }
  );

export type GenerateAdCandidatesResult = Awaited<
  ReturnType<typeof generateAdCandidates>
>;
