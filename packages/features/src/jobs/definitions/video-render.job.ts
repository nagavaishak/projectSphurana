import type { VideoDraftConfig } from '@borradh-workspace/database';
import type {
  SynthesisOverrides,
  Theme,
} from '@borradh-workspace/video-templates';
import { z } from 'zod';
import { type JobInput, type JobOutput, defineJob } from '../define-job.js';
import { videoRenderQueue } from '../queues.js';

const isObject = (v: unknown) => typeof v === 'object' && v !== null;

/**
 * An opaque object field — a type we validate structurally but do not re-model
 * in zod (`VideoDraftConfig`, `Theme`, `SynthesisOverrides`).
 *
 * `z.custom<T>()` types its INPUT as `unknown`, so a producer could pass junk
 * (it still could not *omit* the key — zod v4 keeps it required — but `unknown`
 * gives the call site no help at all). Re-typing it as `ZodType<T, T>` makes the
 * producer's input type the real one, so `theme:` must be a `Theme` or `null`.
 * The runtime check below still rejects a missing/garbage value.
 */
const opaque = <T>(message: string) =>
  z.custom<T>(isObject, { message }) as unknown as z.ZodType<T, T>;

/**
 * THE `video-render` payload. It used to be declared three times (producer,
 * retry path, worker) plus a fourth shape in the worker's render-doc compiler,
 * and the copies disagreed: the retry path's had no `theme` and no
 * `synthesisOverrides`, so **retrying a failed branded render succeeded and
 * produced a video with the wrong theme and none of the frozen content.**
 *
 * Note what is NOT optional here. `theme`, `synthesisOverrides`, `templateId`,
 * `createdById`, `templateDocId`, `variationId`, `skipCompile` and
 * `whatsappDelivery` are declared **required-and-nullable**, not optional. A
 * producer must therefore say `theme: null` on purpose; it cannot *forget*
 * `theme` — that is a compile error. Optionality was the bug.
 */
export const videoRenderPayloadSchema = z.object({
  videoId: z.string().min(1),
  organizationId: z.string().min(1),
  /** The draft the worker turns into a full VideoConfig / RenderDoc. */
  draftConfig: opaque<VideoDraftConfig>('draftConfig is required'),
  /** Template variation id — variation-specific rendering logic. */
  variationId: z.string().nullable(),
  /** Template category id — beat-synced b-roll scheduling. */
  templateId: z.string().nullable(),
  /** Who asked for it — push notification on completion. */
  createdById: z.string().nullable(),
  /** 1 = legacy buildVideoConfig path, 2 = RenderDoc compiler path. */
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  /** v2 template doc id. */
  templateDocId: z.string().nullable(),
  /** v2: reuse the already-compiled `video.renderDoc` instead of recompiling. */
  skipCompile: z.boolean(),
  /**
   * Pre-resolved Theme for v2 renders (brand_kit + per-video overrides). The
   * worker bakes it into `RenderDoc.globals.theme` **so retries replay
   * deterministically** — which is precisely what the old retry path broke by
   * dropping the field.
   */
  theme: opaque<Theme>('theme must be a resolved Theme or null').nullable(),
  /**
   * Frozen-content envelope: `frozenOfferContent` pins info-card slot fills and
   * `pinnedAssets` pins media picks. Dropping it on retry re-rolls the content.
   */
  synthesisOverrides: opaque<SynthesisOverrides>(
    'synthesisOverrides must be an object or null'
  ).nullable(),
  /** Claire-on-WhatsApp delivery tag — proactive delivery of the finished video. */
  whatsappDelivery: z.object({ conversationId: z.string().min(1) }).nullable(),
});

export const videoRenderJob = defineJob({
  queue: videoRenderQueue,
  name: 'render',
  payload: videoRenderPayloadSchema,
  /**
   * Applied ONLY to jobs already sitting in Redis from a deploy that predates
   * these fields. Producers are compile-checked against the full schema, so
   * these can never paper over a producer bug.
   */
  legacyDefaults: {
    variationId: null,
    templateId: null,
    createdById: null,
    schemaVersion: 1,
    templateDocId: null,
    skipCompile: false,
    theme: null,
    synthesisOverrides: null,
    whatsappDelivery: null,
  },
});

export type VideoRenderJobInput = JobInput<typeof videoRenderJob>;
export type VideoRenderJobPayload = JobOutput<typeof videoRenderJob>;
