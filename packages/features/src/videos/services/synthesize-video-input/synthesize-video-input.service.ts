import { video, withOrgScope } from '@borradh-workspace/database';
import { createLogger, trackedResult } from '@borradh-workspace/observability';
import { and, count, eq } from 'drizzle-orm';
import { rotateTemplateSlugs } from '../../../image-generation/index.js';
import { assertServiceMatchesOffer } from '../../../offers/index.js';
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
} from '../../../shared/index.js';
import {
  ORGANIC_TEMPLATE_IDS,
  getTemplateById,
  getVariationById,
} from '../../templates/index.js';
import { buildOfferCard } from '../build-offer-card/index.js';
import {
  type CreateVideoInput,
  type DraftConfig,
  deriveTextFramesFromScript,
  synthesizeDraftConfig,
} from '../create-video/index.js';
import {
  generateOrganicCopy,
  organicCopyToConfigBlock,
  organicVariationIdSchema,
} from '../generate-organic-copy/index.js';
import { generateVideoScript } from '../generate-video-script/index.js';
import { selectBeforeAfterClips } from '../select-before-after-clips/index.js';
import { autoPickClips } from './auto-pick-clips.js';
import {
  type SynthesizeVideoInputInput,
  synthesizeVideoInputSchema,
} from './synthesize-video-input.schema.js';

const logger = createLogger('SynthesizeVideoInput');
/** Re-wrap a tracked (structural) error into a `FeatureError` for propagation. */
const rewrap = (error: {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}): FeatureError => new FeatureError(error.code, error.message, error.details);

/**
 * Synthesise a full `createVideo` input from a partial payload
 * (`{ templateId | format | variationId, serviceId?, offerId? }`) plus org
 * defaults, footage and AI copy.
 *
 * Extracted verbatim from `VideosController.synthesizeFinalInput` so both
 * `POST /videos` (one-prompt create) and `POST /videos/template-preview`
 * build the exact same draft — the preview page exists to show what a real
 * create produces, so the two paths must never diverge.
 *
 * Failure modes are deliberately asymmetric and are load-bearing:
 *   - a `serviceId` that cannot be loaded (e.g. it belongs to another org) is
 *     a SOFT failure — synthesis proceeds without service signals and the id
 *     is still written onto the row;
 *   - a missing / unloadable `offerId` on an offer template ABORTS.
 */
const synthesizeVideoInputImpl = async (
  db: DbConnection,
  input: SynthesizeVideoInputInput
): Promise<Result<CreateVideoInput>> => {
  const parsed = synthesizeVideoInputSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const partial = parsed.data;
  const { organizationId } = partial;

  // Synthesise the full draftConfig from defaults + template + service.
  const defaultsResult = await getOrgDefaults(db, { organizationId });
  if (!defaultsResult.success) {
    return err(rewrap(defaultsResult.error));
  }

  // Optional service lookup — never blocks creation if the service can't
  // be loaded (org may not have services yet, or the ID may be stale).
  let serviceSignals: {
    id?: string;
    name?: string | null;
    description?: string | null;
  } | null = null;
  /** `partial.serviceId`, but only if it resolved INSIDE this org. */
  let resolvedServiceId = partial.serviceId;
  if (partial.serviceId) {
    const serviceResult = await getService(db, {
      id: partial.serviceId,
      organizationId,
    });
    if (serviceResult.success) {
      serviceSignals = {
        id: serviceResult.data.id,
        name: serviceResult.data.name,
        description: serviceResult.data.description,
      };
    } else {
      // Do NOT carry the id forward. `getService` is org-scoped, so a miss
      // means the id is either deleted or belongs to ANOTHER ORG — and this
      // value is persisted verbatim onto the `video.serviceId` column below.
      // The same handler aborts with 404 on a cross-org `offerId`; writing a
      // cross-org `serviceId` instead was the asymmetry.
      //
      // Dropping it rather than erroring keeps the existing soft behaviour
      // honest: the code has already decided to proceed WITHOUT service
      // signals, and a row claiming a service it never resolved contradicts
      // that decision.
      resolvedServiceId = undefined;
      logger.warn(
        `Service ${partial.serviceId} not found for org ${organizationId} during synthesis — proceeding without service signals, and NOT persisting the id`
      );
    }
  }

  // Best-effort org signals for the outro (name + logo).
  let orgSignals: {
    name?: string | null;
    logoUrl?: string | null;
  } | null = null;
  const orgResult = await getOrganization(db, { id: organizationId });
  if (orgResult.success) {
    orgSignals = {
      name: orgResult.data.name,
      logoUrl: orgResult.data.logo,
    };
  } else {
    logger.warn(
      `Failed to load organization signals for ${organizationId}: ${orgResult.error.code} - ${orgResult.error.message}`
    );
  }

  // ROTATE when the caller asked for organic and named no format.
  //
  // Graphics have had this since the batch planner: selection by position from
  // a per-org offset, because a fresh random draw each time "frequently lands
  // on the same layouts" and owners read that as "it looks like last month"
  // even when the copy is entirely new. Videos never got it, so every organic
  // request Claire could not attach a format to resolved to the same template —
  // she picks one from an enum, and she picks consistently.
  //
  // Best-effort: a failed count is offset 0, which is the previous behaviour
  // rather than a failure.
  let rotatedTemplateId: string | undefined;
  if (
    !partial.templateId &&
    !partial.format &&
    partial.usageType === 'organic'
  ) {
    const made = await withOrgScope(
      (tx) =>
        tx
          .select({ value: count() })
          .from(video)
          .where(
            and(
              eq(video.organizationId, organizationId),
              eq(video.usageType, 'organic')
            )
          ),
      { db }
    ).catch(() => null);
    rotatedTemplateId = rotateTemplateSlugs(
      [...ORGANIC_TEMPLATE_IDS],
      1,
      made?.[0]?.value ?? 0
    )[0];
  }

  const synth = synthesizeDraftConfig({
    orgDefaults: defaultsResult.data,
    templateId: partial.templateId ?? rotatedTemplateId,
    format: partial.format,
    variationId: partial.variationId,
    service: serviceSignals,
    organization: orgSignals,
    overrides: partial.draftConfig as Partial<DraftConfig> | undefined,
  });

  // Organic templates (caption-tease, ins-outs, question-cta, improves)
  // don't use a script — their on-screen text comes from a dedicated copy
  // block. Detect via the resolved template's usageType so the branches
  // below assemble the organic draft shape and tag the row as organic.
  const isOrganic = getTemplateById(synth.templateId)?.usageType === 'organic';
  // Offer + before-after are 'ad' templates that need bespoke synthesis
  // (an offerCard block / genuinely-tagged before+after assets). Detect
  // them up front so the generic auto-pick below skips before-after (its
  // clips are resolved by tag, not "most recent N").
  const isOffer = synth.templateId === 'offer';
  const isBeforeAfter = synth.templateId === 'before-after';
  let usageType: 'ad' | 'organic' = 'ad';

  // Auto-populate b-roll clips when the synthesised draft has none.
  // The video worker rejects text_only / ai_voiceover renders with
  // empty bRollClips ("text_only mode requires at least one b-roll
  // clip for visual content"), so a draft that came in via the
  // partial-input path would render-fail immediately. Auto-picking
  // from the org's existing video library makes the one-prompt flow
  // actually produce a renderable draft.
  //
  // Clips linked to the active service sort first; the rest of the
  // library backfills if the service has fewer than the template's
  // recommended count.
  const needsAutoClips =
    !isBeforeAfter &&
    synth.draftConfig.bRollClips.length === 0 &&
    (synth.draftConfig.narrationType === 'text_only' ||
      synth.draftConfig.narrationType === 'ai_voiceover');

  if (needsAutoClips) {
    const lookup = getVariationById(synth.variationId);
    const targetCount = lookup?.variation.recommendedClipCount ?? 3;
    try {
      const picked = await autoPickClips(
        db,
        organizationId,
        resolvedServiceId ?? null,
        targetCount
      );
      if (picked.length > 0) {
        synth.draftConfig.bRollClips = picked.map((assetId, order) => ({
          assetId,
          order,
          clipType: 'bRoll' as const,
        }));
        logger.info(
          `Auto-populated ${picked.length} clips for new draft in org ${organizationId}`
        );
      } else {
        logger.warn(
          `No video assets available for auto-pick in org ${organizationId} — draft will fail to render until clips are added`
        );
      }
    } catch (error) {
      // Auto-pick is best-effort. If asset listing fails the draft
      // still gets created (it just won't render until the user picks
      // clips manually).
      logger.warn(
        `Auto-pick clips failed for org ${organizationId}: ${error instanceof Error ? error.message : 'unknown'}`
      );
    }
  }

  // Before/after templates resolve their clips by tag, not by recency: a
  // before/after video is only meaningful with a genuine "before" and
  // "after" asset (the same media the wizard's picker filters on). If the
  // org hasn't tagged any, `selectBeforeAfterClips` errors with an
  // actionable message rather than mislabelling arbitrary procedure footage
  // as a transformation — surfaced to the user as a BAD_REQUEST.
  if (isBeforeAfter && synth.draftConfig.bRollClips.length === 0) {
    const lookup = getVariationById(synth.variationId);
    const recommended = lookup?.variation.recommendedClipCount ?? 3;
    const clipResult = await selectBeforeAfterClips(db, {
      organizationId,
      serviceId: resolvedServiceId,
      // Procedure clips sit between before + after; reserve those two slots.
      procedureClipCount: Math.max(recommended - 2, 1),
    });
    if (!clipResult.success) {
      return err(rewrap(clipResult.error));
    }
    synth.draftConfig.bRollClips = clipResult.data.clips;
    logger.info(
      `Resolved ${clipResult.data.clips.length} before/after clips for new draft in org ${organizationId}`
    );
  }

  // Replace the template's placeholder-laden scriptText with an AI-
  // generated one when a service is available. The template seed has
  // literal "[PAIN POINT]" / "[SERVICE NAME]" tokens that would render
  // verbatim on screen for text_only narration. The wizard avoids this
  // by calling /videos/generate-script after the wizard form is filled;
  // the synth path needs the same call inline so the one-prompt draft
  // arrives renderable. Best-effort — if AI fails we keep the template
  // and the user can edit later via patchDraftVideo.
  const scriptIsTemplate =
    typeof synth.draftConfig.scriptText === 'string' &&
    /\[[A-Z][A-Z 0-9/-]*\]/.test(synth.draftConfig.scriptText);

  // NOTE the raw `partial.serviceId` in this GATE, beside `resolvedServiceId`
  // in the body below. That asymmetry is DELIBERATE and load-bearing.
  //
  // The caller asking for a service is what says "this video is about a
  // service", even when the id turned out to be unusable. Entering the branch
  // with `serviceId: undefined` produces a GENERIC AI script, which
  // `generateVideoScriptSchema` allows (the field is `.optional()`).
  // Tightening the gate to `resolvedServiceId` would SKIP it instead, and ship
  // the raw template with literal `[SERVICE NAME]` / `[PAIN POINT]` tokens
  // burned into the rendered video. Do not "fix" this to match the body.
  if (scriptIsTemplate && partial.serviceId && !isOrganic) {
    try {
      const scriptResult = await generateVideoScript(db, {
        organizationId,
        templateId: synth.templateId,
        variationId: synth.variationId,
        serviceId: resolvedServiceId,
        narrationMode: synth.draftConfig.narrationType,
      });
      if (scriptResult.success) {
        synth.draftConfig.scriptText = scriptResult.data.scriptText;
        // For text_only drafts, re-derive textFrames from the new
        // script — the synth produced them from the placeholder
        // template and they're now stale.
        if (synth.draftConfig.narrationType === 'text_only') {
          const frames = deriveTextFramesFromScript(
            scriptResult.data.scriptText
          );
          if (frames.length > 0) {
            synth.draftConfig.textFrames = frames;
          }
        }
        logger.info(
          `AI-generated script for new draft in org ${organizationId} (variation ${synth.variationId})`
        );
      } else {
        logger.warn(
          `Script generation failed for org ${organizationId}: ${scriptResult.error.code} - ${scriptResult.error.message} — falling back to template`
        );
      }
    } catch (error) {
      logger.warn(
        `Script generation threw for org ${organizationId}: ${error instanceof Error ? error.message : 'unknown'} — falling back to template`
      );
    }
  }

  // For organic templates, generate the template-specific on-screen copy
  // (the only copy the user supplies for these formats) and reshape the
  // draft to the organic form: captions off, no outro, no script — the
  // on-screen text lives in the organic copy block. Mirrors the
  // monthly-batch path (planVideoDetail) so both entry points render
  // identically. A missing copy block would render blank, so a copy
  // failure aborts creation rather than producing a broken draft.
  if (isOrganic) {
    const variationParse = organicVariationIdSchema.safeParse(
      synth.variationId
    );
    if (!variationParse.success) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          `Template ${synth.templateId} resolved to a non-organic variation (${synth.variationId})`
        )
      );
    }
    const copyResult = await generateOrganicCopy(db, {
      organizationId,
      variationId: variationParse.data,
      serviceId: resolvedServiceId,
    });
    if (!copyResult.success) {
      return err(rewrap(copyResult.error));
    }
    synth.draftConfig.narrationType = 'text_only';
    synth.draftConfig.scriptText = undefined;
    synth.draftConfig.textFrames = undefined;
    synth.draftConfig.captions = {
      ...synth.draftConfig.captions,
      enabled: false,
      showBackground: false,
    };
    synth.draftConfig.outro = undefined;
    Object.assign(synth.draftConfig, organicCopyToConfigBlock(copyResult.data));
    usageType = 'organic';
    logger.info(
      `Assembled organic draft (${synth.templateId}/${synth.variationId}) for org ${organizationId}`
    );
  }

  // Offer templates render a price/discount/CTA card driven by the offer
  // row (the only copy the user supplies for this format). Like the organic
  // path, reshape the draft to text_only with captions off and spread the
  // `offerCard` block; the offer is the mandatory subject, so a missing
  // offerId or a failed card build aborts rather than producing a blank
  // promo. Stays `usageType: 'ad'`.
  if (isOffer) {
    if (!partial.offerId) {
      return err(
        new FeatureError(
          ErrorCodes.VALIDATION_ERROR,
          'offerId is required for offer-format videos. Call listOffers to pick one.'
        )
      );
    }
    // ENG-628: `resolvedServiceId` is org-scoped (validated above) but that
    // does NOT prove it belongs to THIS offer. Reject a valid-but-wrong
    // service before building the offer card / proceeding with synthesis.
    // Only meaningful when a service actually resolved — a dropped/absent id
    // places no constraint to reconcile.
    if (resolvedServiceId) {
      const serviceMatch = await assertServiceMatchesOffer(db, {
        organizationId,
        offerId: partial.offerId,
        serviceId: resolvedServiceId,
      });
      if (!serviceMatch.success) {
        return err(rewrap(serviceMatch.error));
      }
    }
    const offerCardResult = await buildOfferCard(db, {
      organizationId,
      offerId: partial.offerId,
      serviceId: resolvedServiceId,
      serviceName: serviceSignals?.name ?? undefined,
      businessName: orgSignals?.name ?? undefined,
    });
    if (!offerCardResult.success) {
      return err(rewrap(offerCardResult.error));
    }
    synth.draftConfig.narrationType = 'text_only';
    synth.draftConfig.scriptText = undefined;
    synth.draftConfig.textFrames = undefined;
    synth.draftConfig.captions = {
      ...synth.draftConfig.captions,
      enabled: false,
      showBackground: false,
    };
    // Offer card uses the 1080x1080 side-by-side layout.
    synth.draftConfig.orientation = 'square';
    Object.assign(synth.draftConfig, offerCardResult.data);
    // Caller-supplied copy wins: when Claire passes an `offerCard` override
    // (the owner asked for specific wording — e.g. "make an offer video
    // that says X"), merge those fields over the generated card so the
    // pricing/branding the builder resolved still survive.
    const offerCardOverride = (
      partial.draftConfig as { offerCard?: Record<string, unknown> } | undefined
    )?.offerCard;
    if (offerCardOverride && synth.draftConfig.offerCard) {
      synth.draftConfig.offerCard = {
        ...synth.draftConfig.offerCard,
        ...offerCardOverride,
      } as typeof synth.draftConfig.offerCard;
    }
    logger.info(
      `Assembled offer draft (offer ${partial.offerId}) for org ${organizationId}`
    );
  }

  return ok({
    title: partial.title ?? synth.title,
    templateId: synth.templateId,
    variationId: synth.variationId,
    serviceId: resolvedServiceId,
    offerId: partial.offerId,
    draftConfig: synth.draftConfig,
    organizationId,
    createdById: partial.createdById,
    usageType,
  });
};

export const synthesizeVideoInput = (
  db: DbConnection,
  input: SynthesizeVideoInputInput
) =>
  trackedResult(
    'videos.synthesizeVideoInput',
    () => synthesizeVideoInputImpl(db, input),
    {
      properties: {
        organizationId: input.organizationId,
        templateId: input.templateId,
        format: input.format,
        variationId: input.variationId,
      },
    }
  );

export type SynthesizeVideoInputResult = Awaited<
  ReturnType<typeof synthesizeVideoInput>
>;
