import {
  type Database,
  and,
  eq,
  isNull,
  orgDefaults,
  video,
  withOrgScope,
} from '@borradh-workspace/database';
import { trackedResult } from '@borradh-workspace/observability';
import {
  educational1,
  getTemplateDocById,
} from '@borradh-workspace/video-templates';
import { getMusicTrackById } from '@borradh-workspace/video-templates/music-registry';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { getResolvedTheme } from '../get-resolved-theme/index.js';
import { enqueueVideoRender } from '../queue-video-export/queue-video-export.service.js';
import { estimateDuration } from './phase-a-estimate.js';
import { gateSlots } from './phase-a-gate.js';
import { resolveScriptSlot } from './phase-a-script.js';
import { generateSeed } from './seeded-rng.js';
import {
  type SynthesizeTemplateInput,
  synthesizeTemplateSchema,
} from './synthesize-template.schema.js';

export interface SynthesizeTemplateOutput {
  estimatedDurationSec: number;
  scriptText: string;
  /**
   * Seed used for this synthesis. Echoed back so callers can correlate /
   * replay. If the input omitted `seed`, this is the auto-generated value
   * we persisted on the video row.
   */
  seed: number;
}

async function synthesizeTemplateImpl(
  db: Database,
  input: SynthesizeTemplateInput
): Promise<Result<SynthesizeTemplateOutput>> {
  const parsed = synthesizeTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Invalid synthesize template input',
        { issues: parsed.error.issues }
      )
    );
  }

  const videoRecord = await db.query.video.findFirst({
    where: (v, { and, eq, isNull }) =>
      and(
        eq(v.id, parsed.data.videoId),
        eq(v.organizationId, parsed.data.organizationId),
        isNull(v.deletedAt)
      ),
  });
  if (!videoRecord) {
    return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Video not found'));
  }
  if (!videoRecord.draftConfig) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'Video has no draft config to synthesize'
      )
    );
  }

  const defaults = await db.query.orgDefaults.findFirst({
    where: eq(orgDefaults.organizationId, parsed.data.organizationId),
    columns: { videoTemplateEngineV2: true },
  });
  if (!defaults?.videoTemplateEngineV2) {
    return err(
      new FeatureError(
        ErrorCodes.FORBIDDEN,
        'Video template engine v2 is not enabled for this organization'
      )
    );
  }

  // Seed resolution: caller-supplied → previously-persisted (re-synth replay)
  // → freshly generated. We always end up with a 32-bit non-negative int that
  // gets persisted below so the next re-synth can replay it.
  const seed = parsed.data.seed ?? videoRecord.synthesisSeed ?? generateSeed();

  // synthesis_overrides: caller's input wins over the value persisted on the
  // video row. The backfill writes persistent overrides; fresh-creation flows
  // omit them. Theme overrides from synthesisOverrides are merged BEHIND the
  // caller's themeOverrides (i.e. caller's themeOverrides take precedence).
  const persistedOverrides = videoRecord.synthesisOverrides ?? undefined;
  const synthesisOverrides =
    parsed.data.synthesisOverrides ?? persistedOverrides;
  const themeOverrides =
    parsed.data.themeOverrides ?? synthesisOverrides?.themeOverrides;

  // Resolve the active Theme (engine defaults → brand_kit → per-video
  // overrides). The gate consumes this for brand slot satisfaction; the
  // worker bakes it into RenderDoc.globals.theme.
  const themeResult = await getResolvedTheme(db, {
    organizationId: parsed.data.organizationId,
    themeOverrides,
  });
  if (!themeResult.success) {
    // trackedResult returns a structurally-compatible error but with the
    // plain ResultShape shape; re-wrap as a FeatureError so the caller's
    // Result<T> contract stays clean.
    return err(
      new FeatureError(
        themeResult.error.code as never,
        themeResult.error.message,
        themeResult.error.details
      )
    );
  }
  const theme = themeResult.data;

  // Resolve the TemplateDoc from the video's variationId (the renderdoc id),
  // falling back to templateId, then educational1. This drives the asset gate,
  // script slots, and the templateDocId enqueued for Phase B — so every
  // registered template renders as itself (not always educational-1).
  const templateDoc =
    getTemplateDocById(videoRecord.variationId ?? '') ??
    getTemplateDocById(videoRecord.templateId ?? '') ??
    educational1;
  const gate = await gateSlots(
    db,
    templateDoc,
    parsed.data.organizationId,
    seed,
    theme
  );
  if (!gate.passed) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Missing required assets', {
        missing: gate.missing,
      })
    );
  }

  const scriptResult = await resolveScriptSlot(db, parsed.data, templateDoc, {
    seed,
    frozenScript: synthesisOverrides?.frozenScript,
  });
  if (!scriptResult.success) return scriptResult;

  const musicTrack = getMusicTrackById(
    videoRecord.draftConfig?.musicTrackId ?? ''
  );
  const estimatedDurationSec = estimateDuration(
    templateDoc,
    scriptResult.data.scriptText,
    musicTrack?.bpm ?? 100
  );
  const draftConfig = {
    ...videoRecord.draftConfig,
    scriptText: scriptResult.data.scriptText,
    // Persist the structured roles too — the v2 compiler needs them to source
    // multi-list templates (e.g. ins-outs INS vs OUTS) that the flattened
    // scriptText can't represent. Plain text stays for legacy/v1 paths.
    scriptRoles: scriptResult.data.response,
  };

  await db
    .update(video)
    .set({
      schemaVersion: 2,
      draftConfig,
      status: 'queued',
      progress: 0,
      errorMessage: null,
      synthesisSeed: seed,
      // Persist whichever overrides were used (caller's, falling back to
      // already-persisted) so a future re-synth without input replays the
      // same content shape.
      ...(synthesisOverrides !== undefined ? { synthesisOverrides } : {}),
    })
    .where(and(eq(video.id, parsed.data.videoId), isNull(video.deletedAt)));

  await enqueueVideoRender({
    videoId: parsed.data.videoId,
    organizationId: parsed.data.organizationId,
    draftConfig,
    variationId: videoRecord.variationId ?? null,
    templateId: videoRecord.templateId ?? null,
    createdById: videoRecord.createdById ?? null,
    schemaVersion: 2,
    templateDocId: templateDoc.id,
    skipCompile: false,
    theme,
    synthesisOverrides: synthesisOverrides ?? null,
    whatsappDelivery: null,
  });

  return ok({
    estimatedDurationSec,
    scriptText: scriptResult.data.scriptText,
    seed,
  });
}

export const synthesizeTemplate = (
  db: Database,
  input: SynthesizeTemplateInput
) =>
  trackedResult(
    'videos.synthesizeTemplate',
    () =>
      withOrgScope((tx) => synthesizeTemplateImpl(tx as Database, input), {
        db,
      }),
    {
      properties: {
        videoId: input.videoId,
        organizationId: input.organizationId,
      },
    }
  );

export type SynthesizeTemplateResult = Awaited<
  ReturnType<typeof synthesizeTemplate>
>;
