/**
 * `generateGraphicFromService` — one-shot graphic generation for the social
 * new-post flow.
 *
 * The HTTP request is short-lived: we validate + insert a `graphic` row
 * with `status='rendering'` synchronously and return it. The actual work
 * (template selection via Claude, slide rasterisation, S3 upload) runs on
 * the `graphic-generate` BullMQ queue, processed by
 * `apps/video-worker/src/graphic-generate-processor.ts`. The worker's
 * materialise step upserts the same `graphic.id` to `status='ready'`, or
 * flips it to `'failed'` on error. The frontend polls `GET /graphics/:id`
 * to surface the transition.
 *
 * Why queue + worker (not inline void Promise): the bulk content generator
 * fans out ~12 graphics per batch and several batches can run per cron
 * tick. Running rasters inline on the API process competes with request
 * traffic on a small Fly machine. The worker has bounded concurrency,
 * retries, and survives API restarts.
 */

import { randomUUID } from 'node:crypto';
import {
  type Graphic,
  asset,
  graphic,
  offer as offerTable,
  organization,
  organizationService,
  withOrgScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { and, eq, inArray } from 'drizzle-orm';
import {
  getDeckBrief,
  getSingleBrief,
  getSingleTemplate,
} from '../../../image-generation/carousel-templates/index.js';
import { assertServiceMatchesOffer } from '../../../offers/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  notDeleted,
  ok,
} from '../../../shared/index.js';
import { queueGraphicGenerate } from '../queue-graphic-generate/index.js';
import {
  type GenerateGraphicFromServiceInput,
  generateGraphicFromServiceSchema,
} from './generate-graphic-from-service.schema.js';

const generateGraphicFromServiceImpl = async (
  db: DbConnection,
  input: GenerateGraphicFromServiceInput
): Promise<Result<Graphic>> => {
  const parsed = generateGraphicFromServiceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const {
    organizationId,
    serviceId,
    category,
    allowAiImages,
    sourceAssetIds,
    allowStockImages,
    usageType,
    offerId,
    refinementInstruction,
    whatsappDelivery,
  } = parsed.data;
  const isAd = usageType === 'ad';

  // ── 1. Validate org + service synchronously ───────────────────────────
  const [orgRow, serviceRow] = await withOrgScope(
    (tx) =>
      Promise.all([
        tx.query.organization.findFirst({
          where: and(
            eq(organization.id, organizationId),
            notDeleted(organization)
          ),
          columns: { id: true, name: true, primaryColor: true },
        }),
        tx.query.organizationService.findFirst({
          where: eq(organizationService.id, serviceId),
          columns: { id: true, name: true, organizationId: true },
        }),
      ]),
    { db }
  );

  if (!orgRow) {
    return err(
      new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
    );
  }
  if (!serviceRow) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Service not found'));
  }
  if (serviceRow.organizationId !== organizationId) {
    return err(
      new FeatureError(ErrorCodes.FORBIDDEN, 'Service belongs to another org')
    );
  }

  // The picker may show every uploaded org image, not just service-tagged
  // media. Validate ownership + raw image type before creating a job so an
  // invalid/stale selection cannot silently fall back to an automatic image.
  if (sourceAssetIds?.length) {
    const selectedAssets = await withOrgScope(
      (tx) =>
        tx.query.asset.findMany({
          where: and(
            eq(asset.organizationId, organizationId),
            eq(asset.type, 'image'),
            eq(asset.source, 'raw'),
            inArray(asset.id, sourceAssetIds),
            notDeleted(asset)
          ),
          columns: { id: true },
        }),
      { db }
    );
    const foundIds = new Set(selectedAssets.map((item) => item.id));
    const missingIds = sourceAssetIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'One or more selected images are unavailable. Choose uploaded images from the gallery and try again.',
          { missingAssetIds: missingIds }
        )
      );
    }
  }

  // ── 1b. Ad graphics require a valid offer (the badge/treatment/CTA copy is
  //        composed from it). Validate ownership before we insert anything. ─
  if (isAd) {
    if (!offerId) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'A paid-ad graphic requires an offerId'
        )
      );
    }
    const offerRow = await withOrgScope(
      (tx) =>
        tx.query.offer.findFirst({
          where: eq(offerTable.id, offerId),
          columns: { id: true, organizationId: true },
        }),
      { db }
    );
    if (!offerRow) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Offer not found'));
    }
    if (offerRow.organizationId !== organizationId) {
      return err(
        new FeatureError(ErrorCodes.FORBIDDEN, 'Offer belongs to another org')
      );
    }

    // ENG-628: the picked `serviceId` is org-owned (checked above) but that
    // does NOT prove it belongs to THIS offer. Reject a valid-but-wrong
    // service before we write the graphic row / enqueue the render.
    const serviceMatch = await assertServiceMatchesOffer(db, {
      organizationId,
      offerId,
      serviceId,
    });
    if (!serviceMatch.success) {
      return err(
        new FeatureError(
          serviceMatch.error.code,
          serviceMatch.error.message,
          serviceMatch.error.details
        )
      );
    }
  }

  // ── 1c. Resolve an explicit style if one was chosen ───────────────────
  //
  // The chosen style decides the KIND: a deck brief forces a carousel, a single
  // brief or an ad template forces a single. Organic styles are briefs;
  // composition templates survive for ads, where the layout genuinely is the
  // choice. Both lookups accept the composition slug a brief took over from, so
  // a style pinned before briefs had identities still resolves.
  const { templateSlug } = parsed.data;
  let templateKind: 'single' | 'carousel' | undefined;
  if (templateSlug) {
    const deckBrief = isAd ? undefined : getDeckBrief(templateSlug);
    const singleBrief =
      deckBrief || isAd ? undefined : getSingleBrief(templateSlug);
    const adTemplate =
      deckBrief || singleBrief ? undefined : getSingleTemplate(templateSlug);
    if (!deckBrief && !singleBrief && !adTemplate) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Unknown graphic style: ${templateSlug}`
        )
      );
    }
    if (adTemplate && adTemplate.usageType !== usageType) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Template '${templateSlug}' is a ${adTemplate.usageType} template and cannot be used for a ${usageType} graphic`
        )
      );
    }
    templateKind = deckBrief ? 'carousel' : 'single';
  }

  // ── 2. Resolve kind + topicSummary ────────────────────────────────────
  // Ad graphics are single-image only (offer + badge + CTA); never carousel.
  const kind: 'single' | 'carousel' = isAd
    ? 'single'
    : (templateKind ??
      parsed.data.kind ??
      (Math.random() < 0.5 ? 'single' : 'carousel'));
  const topicSummary = parsed.data.topicSummary ?? `Promote ${serviceRow.name}`;

  // ── 3. INSERT placeholder graphic row (status='rendering') ────────────
  //
  // The frontend gets this row immediately and polls until status flips to
  // `'ready'` or `'failed'`. `serviceId` / `topicSummary` / `kind` capture
  // what the graphic was generated from so it can be re-rolled (regenerate).
  const newGraphicId = randomUUID();
  const placeholderTitle = `Generating: ${serviceRow.name}`;
  let placeholder: Graphic;
  try {
    const [row] = await withOrgScope(
      (tx) =>
        tx
          .insert(graphic)
          .values({
            id: newGraphicId,
            title: placeholderTitle,
            status: 'rendering',
            usageType,
            offerId: offerId ?? null,
            sourceAssetIds: sourceAssetIds ?? null,
            allowAiImages,
            serviceId,
            topicSummary,
            kind,
            aspectRatio: '4:5',
            canvasWidth: 1080,
            canvasHeight: 1350,
            outputs: null,
            organizationId,
            createdById: null,
          })
          .returning(),
      { db }
    );
    if (!row) {
      return err(
        new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Insert returned no row')
      );
    }
    placeholder = row;
  } catch (error) {
    logError('graphics.generateGraphicFromService.insert', error, {
      feature: 'graphics',
      extra: { organizationId, serviceId, kind, usageType },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to insert placeholder graphic',
        undefined,
        error instanceof Error ? error : undefined
      )
    );
  }

  // ── 4. Enqueue the render job ────────────────────────────────────────
  //
  // The worker runs `planImageDetail` (Claude) + `renderGraphicSlides`
  // (node-canvas + S3) and the materialise step upserts the row to
  // `status='ready'`. On failure the worker flips the row to `'failed'`
  // so the polling client sees the transition.
  const brandPrimaryColor = orgRow.primaryColor ?? '#6366F1';
  const enqueueResult = await queueGraphicGenerate({
    mode: 'plan-and-render',
    graphicId: newGraphicId,
    organizationId,
    serviceId,
    kind,
    category,
    topicSummary,
    brandPrimaryColor,
    allowAiImages,
    sourceAssetIds,
    allowStockImages,
    usageType,
    ...(offerId ? { offerId } : {}),
    ...(refinementInstruction ? { refinementInstruction } : {}),
    ...(templateSlug ? { templateSlug } : {}),
    ...(whatsappDelivery ? { whatsappDelivery } : {}),
  });
  if (!enqueueResult.success) {
    // Roll the placeholder row back so the UI doesn't poll forever.
    await withOrgScope(
      (tx) =>
        tx
          .update(graphic)
          .set({ status: 'failed', updatedAt: new Date() })
          .where(eq(graphic.id, newGraphicId)),
      { db }
    ).catch(() => {});
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        `Failed to enqueue graphic render: ${enqueueResult.error.message}`
      )
    );
  }

  // ── 5. Return the placeholder ────────────────────────────────────────
  return ok(placeholder);
};

export const generateGraphicFromService = (
  db: DbConnection,
  input: GenerateGraphicFromServiceInput
) =>
  trackedResult(
    'graphics.generateGraphicFromService',
    () => generateGraphicFromServiceImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        serviceId: input.serviceId,
        category: input.category,
      },
    }
  );

export type GenerateGraphicFromServiceResult = Awaited<
  ReturnType<typeof generateGraphicFromService>
>;
