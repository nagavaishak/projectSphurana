import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { listOffers } from '../../../offers/index.js';
import { listServicesForOrg } from '../../../organization-services/index.js';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getVariationById } from '../../templates/index.js';
import { createVideo } from '../create-video/index.js';
import { queueVideoExport } from '../queue-video-export/index.js';
import { synthesizeTemplate } from '../synthesize-template/index.js';
import {
  autoPickClips,
  synthesizeVideoInput,
} from '../synthesize-video-input/index.js';
import {
  type PreviewTemplateRenderInput,
  type PreviewTemplateRenderOutput,
  previewTemplateRenderSchema,
} from './preview-template-render.schema.js';

const logger = createLogger('PreviewTemplateRender');
/** Re-wrap a tracked (structural) error into a `FeatureError` for propagation. */
const rewrap = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): FeatureError => new FeatureError(error.code, error.message, error.details);

/**
 * Render a single template through either the legacy engine (`v1`) or the
 * renderdoc engine (`v2`) so the two can be compared side-by-side in the
 * template-feedback page. Each call creates a FRESH video row (BullMQ jobId
 * = videoId, so reusing a row would dedup the render) by synthesising the
 * same full draftConfig a one-prompt create would — via the SAME
 * `synthesizeVideoInput` use case `POST /videos` uses, which is what keeps
 * the preview honest — then dispatching:
 *   - `v2` → `synthesizeTemplate` (resolves the TemplateDoc, renders via the
 *     renderdoc Lambda bundle),
 *   - `v1` → `queueVideoExport` (legacy `buildVideoConfig` path).
 */
const previewTemplateRenderImpl = async (
  db: DbConnection,
  input: PreviewTemplateRenderInput
): Promise<Result<PreviewTemplateRenderOutput>> => {
  const parsed = previewTemplateRenderSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const body = parsed.data;
  const { organizationId } = body;

  if (body.version !== 'v1' && body.version !== 'v2') {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        "version must be 'v1' or 'v2'"
      )
    );
  }
  if (!body.templateId && !body.variationId && !body.format) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'templateId, variationId or format is required'
      )
    );
  }
  const version: 'v1' | 'v2' = body.version;

  logger.info(
    `Template preview (${version}) for org ${organizationId}: ` +
      `template=${body.templateId ?? body.variationId ?? body.format}`
  );

  // Auto-pick a service when the caller didn't supply one so organic/script
  // copy generation has a real subject. Best-effort — synthesis still runs
  // without a service (it just falls back to generic copy).
  let serviceId = body.serviceId;
  if (!serviceId) {
    const services = await listServicesForOrg(db, { organizationId });
    if (services.success && services.data.length > 0) {
      serviceId = services.data[0].id;
    }
  }

  // Offer templates require an offerId (the card's mandatory subject). The
  // preview page doesn't pick one, so auto-select the org's most recent
  // offer — preferring active ones — to match the create dialog, which
  // gates offer rendering on a chosen offer.
  let offerId = body.offerId;
  const isOfferPreview =
    body.templateId === 'offer' ||
    body.variationId === 'offer-square-1' ||
    body.format === 'offer';
  if (!offerId && isOfferPreview) {
    const active = await listOffers(db, {
      organizationId,
      state: 'active',
      limit: 1,
      offset: 0,
    });
    if (active.success && active.data.items.length > 0) {
      offerId = active.data.items[0].id;
    } else {
      const any = await listOffers(db, {
        organizationId,
        limit: 1,
        offset: 0,
      });
      if (any.success && any.data.items.length > 0) {
        offerId = any.data.items[0].id;
      }
    }
  }

  const synthesized = await synthesizeVideoInput(db, {
    organizationId,
    createdById: body.createdById,
    templateId: body.templateId,
    variationId: body.variationId,
    format: body.format,
    serviceId,
    offerId,
  });
  if (!synthesized.success) return err(rewrap(synthesized.error));
  const finalInput = synthesized.data;

  // Mirror the create dialog (`GenerateVideoDialog`): it never renders the
  // `recorded` talking-head mode — for ad templates it defaults to
  // `ai_voiceover` (AI script + default voice), which is what users actually
  // generate. The synth path leaves these templates as `recorded` (the
  // variation's declared narrationMode), which (a) fails the v1 pre-flight
  // gate without talking-head footage and (b) leaves v2 with no
  // `narrationDurationFrames` for TemplateDocs whose master duration is
  // "driven by narration". Switching to ai_voiceover fixes both: v1 gets a
  // voiced render, v2's compiler measures the TTS duration.
  const cfg = finalInput.draftConfig;
  if (cfg.narrationType === 'recorded') {
    cfg.narrationType = 'ai_voiceover';
    // Default voice = `aiVoiceIdValues[0]` (`af_heart`), matching the
    // dialog's `DEFAULT_AI_VOICE`.
    cfg.aiVoiceId = cfg.aiVoiceId ?? 'af_heart';
    cfg.talkingHeadUrl = null;
    // ai_voiceover requires a script + at least one b-roll clip. The synth
    // seeds scriptText; recorded drafts skip the synth-time clip auto-pick
    // (it only runs for text_only/ai_voiceover), so backfill clips here.
    if (cfg.bRollClips.length === 0) {
      const lookup = getVariationById(finalInput.variationId ?? '');
      const targetCount = lookup?.variation.recommendedClipCount ?? 3;
      const picked = await autoPickClips(
        db,
        organizationId,
        serviceId ?? null,
        targetCount
      );
      cfg.bRollClips = picked.map((assetId, order) => ({
        assetId,
        order,
        clipType: 'bRoll' as const,
      }));
    }
    logger.info(
      `Template preview: recorded → ai_voiceover (dialog parity), ${cfg.bRollClips.length} clips`
    );
  }

  const created = await createVideo(db, finalInput);
  if (!created.success) {
    logger.warn(
      `Template preview create failed: ${created.error.code} - ${created.error.message}`
    );
    return err(rewrap(created.error));
  }

  const videoId = created.data.id;

  if (version === 'v2') {
    const synth = await synthesizeTemplate(db, { videoId, organizationId });
    if (!synth.success) {
      logger.warn(
        `Template preview v2 synthesize failed: ${synth.error.code} - ${synth.error.message}`
      );
      return err(rewrap(synth.error));
    }
  } else {
    const queued = await queueVideoExport(db, { id: videoId });
    if (!queued.success) {
      logger.warn(
        `Template preview v1 export failed: ${queued.error.code} - ${queued.error.message}`
      );
      return err(rewrap(queued.error));
    }
  }

  logger.info(`Template preview ${version} queued: video ${videoId}`);
  return ok({ videoId });
};

export const previewTemplateRender = (
  db: DbConnection,
  input: PreviewTemplateRenderInput
) =>
  trackedResult(
    'videos.previewTemplateRender',
    () => previewTemplateRenderImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        templateId: input.templateId,
        variationId: input.variationId,
        format: input.format,
      },
    }
  );

export type PreviewTemplateRenderResult = Awaited<
  ReturnType<typeof previewTemplateRender>
>;
