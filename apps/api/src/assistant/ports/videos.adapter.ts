import type {
  AvailableAsset,
  CreateBlockedReason,
  ExportResult,
  RenderBlockedReason,
  VideoDraft,
  VideoDraftRequest,
  VideoLifecycleStatus,
  VideoTextFrame,
  VideosPort,
} from '@borradh-workspace/contracts/ports';
// Imported from the module, not the tool-factory barrel. The barrel reaches
// `tool-context.ts`, which builds these ports — importing it here would close a
// cycle, and would drag the database package into anything that touches a port.
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';

/**
 * Verbatim copies of `failedBrollClipsMessage` / `pendingBrollClipsMessage`
 * from `packages/features/src/videos/services/queue-video-export`.
 *
 * Copied rather than imported on purpose: importing them pulls the whole
 * `features/videos` barrel — and its AI clients — into every module that
 * touches the tool context, which is exactly the runtime fan-out ports exist to
 * avoid. `videos.adapter.spec.ts` imports both sides and asserts they are
 * identical, so a reworded service message fails a test instead of silently
 * degrading these two cases to `other`.
 */
const FAILED_B_ROLL_MESSAGE =
  'Some b-roll clips could not be prepared. Replace or re-upload them before rendering.';
const PENDING_B_ROLL_MESSAGE =
  'Some b-roll clips are still processing. Please wait a moment and try again.';

/**
 * Concrete `VideosPort`, built at the composition root.
 *
 * TRANSPORT NOTE. This adapter reaches the videos capability over the existing
 * authenticated loopback (`apiFetch`), not by calling feature services with a
 * `db` handle. That is deliberate for this phase: draft creation runs through
 * `VideosController.synthesizeFinalInput` — org defaults, service signals, AI
 * script generation, before/after clip resolution — which lives in the
 * controller, not in `packages/features`. Calling `createVideo` directly would
 * silently skip all of it. Extracting that synthesis is separate work; the
 * port's whole point is that callers cannot tell, and the transport can be
 * swapped underneath without touching a single tool.
 *
 * What the port DOES buy today is the honest-state boundary. Everything that
 * came back from `apiFetch` as an untyped bag — `{ rendered, status, error }` —
 * is narrowed here, exactly once, into a discriminated union. A tool can no
 * longer relay "your video is rendering" about a queued job, because there is
 * no field left that says so.
 */

interface CreateVideoResponse {
  id: string;
  title: string;
  /** Present on `POST /videos`, which opens the item. Absent on reads. */
  itemId?: string | null;
  attemptNumber?: number | null;
  attemptId?: string | null;
  templateId?: string;
  variationId?: string;
  serviceId?: string | null;
  draftConfig?: {
    scriptText?: string;
    orientation?: string;
    narrationType?: string;
    bRollClips?: Array<{ assetId: string; order?: number }>;
    textFrames?: VideoTextFrame[];
  };
}

interface VideoRecordResponse {
  id: string;
  title: string;
  status: string;
  progress: number | null;
  blobUrl: string | null;
  thumbnailUrl: string | null;
  durationMs: number | null;
  errorMessage?: string | null;
}

interface VideoJobResponse {
  progress: number | null;
  processingStage: string | null;
}

interface PatchDraftConfigResponse {
  video: CreateVideoResponse & { status?: string };
  rendered: boolean;
  renderMessage?: string;
}

interface AssetResponse {
  id: string;
  name: string;
  type: string;
  duration: number | null;
  blobUrl: string | null;
  thumbnailUrl: string | null;
  tags: unknown;
}

const LIFECYCLE_STATUSES: readonly string[] = [
  'draft',
  'queued',
  'processing',
  'ready',
  'failed',
];

function asLifecycleStatus(
  raw: string | undefined
): VideoLifecycleStatus | 'unknown' {
  return raw && LIFECYCLE_STATUSES.includes(raw)
    ? (raw as VideoLifecycleStatus)
    : 'unknown';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * A 4xx is the API stating a reason (validation, state, not-found) — an
 * ordinary outcome the owner can act on. Anything else is the server breaking.
 * The distinction is what lets callers alert on faults without alerting on
 * every "no, because…".
 */
function isServerFault(error: unknown): boolean {
  return !(
    error instanceof ApiFetchError &&
    error.status >= 400 &&
    error.status < 500
  );
}

/**
 * Map a failure from `POST /videos/:id/export` onto a render reason.
 *
 * The two b-roll cases match the service's own message text (see the constants
 * above, and the spec that pins them to the service); the rest match the shapes
 * `queueVideoExport` builds. Anything unrecognised keeps the server's own words
 * — as `other` when the API stated a reason (4xx), as `server_error` when it
 * simply broke — because a wrong `kind` is worse than an unnamed one.
 */
export function toRenderBlockedReason(
  error: unknown,
  videoId: string
): RenderBlockedReason {
  const message = errorMessage(error, 'Failed to queue video export');

  if (message === FAILED_B_ROLL_MESSAGE) {
    return { kind: 'b_roll_transcode_failed' };
  }
  if (message === PENDING_B_ROLL_MESSAGE) {
    return { kind: 'b_roll_still_processing' };
  }
  if (error instanceof ApiFetchError && error.status === 404) {
    return { kind: 'video_not_found', videoId };
  }

  const wrongStatus = /^Video cannot be queued\. Current status: (\w+)$/.exec(
    message
  );
  if (wrongStatus) {
    return {
      kind: 'not_a_draft',
      currentStatus: asLifecycleStatus(wrongStatus[1]),
    };
  }

  const incomplete = /^Video configuration is incomplete: (.+)$/.exec(message);
  if (incomplete) {
    return { kind: 'incomplete_config', detail: incomplete[1] };
  }
  if (message.startsWith('Video has no draft configuration')) {
    return {
      kind: 'incomplete_config',
      detail: 'the draft has no configuration yet',
    };
  }

  return isServerFault(error)
    ? { kind: 'server_error', message }
    : { kind: 'other', message };
}

/** Map a failure from `POST /videos` onto a creation reason. */
export function toCreateBlockedReason(
  error: unknown,
  req: VideoDraftRequest
): CreateBlockedReason {
  const message = errorMessage(error, 'Failed to create draft video');

  if (
    /before.*after/i.test(message) &&
    /media|photo|footage|tag/i.test(message)
  ) {
    const missing: ('before' | 'after')[] = [];
    if (/\bbefore\b/i.test(message)) missing.push('before');
    if (/\bafter\b/i.test(message)) missing.push('after');
    return {
      kind: 'missing_before_after_media',
      missing: missing.length > 0 ? missing : ['before', 'after'],
    };
  }
  if (
    req.offerId &&
    /offer/i.test(message) &&
    /not found|invalid/i.test(message)
  ) {
    return { kind: 'offer_not_found', offerId: req.offerId };
  }
  if (/service/i.test(message) && /not found/i.test(message)) {
    return { kind: 'service_not_found', serviceId: req.serviceId };
  }

  return isServerFault(error)
    ? { kind: 'server_error', message }
    : { kind: 'other', message };
}

function toDraft(
  response: CreateVideoResponse,
  req?: VideoDraftRequest
): VideoDraft {
  const config = response.draftConfig ?? {};
  return {
    videoId: response.id,
    title: response.title,
    templateId: response.templateId,
    variationId: response.variationId,
    serviceId: response.serviceId ?? req?.serviceId,
    scriptText: config.scriptText,
    orientation: config.orientation,
    narrationType: config.narrationType,
    clipAssetIds: (config.bRollClips ?? [])
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((clip) => clip.assetId),
    textFrames: config.textFrames ?? [],
    itemId: response.itemId ?? null,
    attemptNumber: response.attemptNumber ?? null,
    attemptId: response.attemptId ?? null,
  };
}

function toAvailableAsset(asset: AssetResponse): AvailableAsset {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    duration: asset.duration ?? null,
    blobUrl: asset.blobUrl ?? null,
    thumbnailUrl: asset.thumbnailUrl ?? null,
    tags: Array.isArray(asset.tags)
      ? asset.tags.filter((t): t is string => typeof t === 'string')
      : [],
  };
}

export interface VideosPortDeps {
  apiFetch: ApiFetchFn;
  /** WhatsApp renders are tagged so the finished video is pushed to the thread. */
  channel?: 'web' | 'whatsapp';
  conversationId: string;
}

export function createVideosPort(deps: VideosPortDeps): VideosPort {
  const { apiFetch, channel, conversationId } = deps;

  /** WhatsApp has no client to poll, so renders carry a delivery tag. */
  const deliverTo =
    channel === 'whatsapp'
      ? { deliverTo: { channel: 'whatsapp', conversationId } }
      : {};

  async function queueExport(videoId: string): Promise<ExportResult> {
    try {
      // v1 `/export` (buildVideoConfig render). The v2 render-doc engine
      // (`/synthesize`) is still in development, so every Claire render goes
      // through v1.
      await apiFetch(`videos/${videoId}/export`, {
        method: 'POST',
        body: { allowStockFootage: true, ...deliverTo },
      });
      return { status: 'queued', videoId };
    } catch (error) {
      return {
        status: 'blocked',
        videoId,
        reason: toRenderBlockedReason(error, videoId),
      };
    }
  }

  return {
    async createDraft(req) {
      let created: CreateVideoResponse;
      try {
        created = await apiFetch<CreateVideoResponse>('videos', {
          method: 'POST',
          body: {
            format: req.format,
            templateId: req.templateId,
            serviceId: req.serviceId,
            offerId: req.offerId,
            title: req.title,
            usageType: req.usageType,
            // Owner-dictated offer copy rides through as a partial draftConfig;
            // the controller merges it over the generated card so pricing and
            // branding survive.
            ...(req.offerCopy
              ? { draftConfig: { offerCard: req.offerCopy } }
              : {}),
          },
        });
      } catch (error) {
        return { status: 'blocked', reason: toCreateBlockedReason(error, req) };
      }

      const draft = toDraft(created, req);
      if (req.autoRender !== true) return { status: 'draft', draft };

      const exported = await queueExport(draft.videoId);
      return exported.status === 'queued'
        ? { status: 'queued', draft }
        : {
            status: 'draft_render_refused',
            draft,
            reason: exported.reason,
          };
    },

    export: queueExport,

    async patchDraft({
      videoId,
      patch,
      clipOperations,
      title,
      requeueRender = true,
    }) {
      let targetId = videoId;

      if (!targetId) {
        // Most recent patchable draft. The list endpoint already orders by
        // createdAt desc; `failed` is patchable too (fix and re-render).
        const list = await apiFetch<{
          items?: { id: string; status: string }[];
        }>('videos?limit=10');
        const candidate = (list?.items ?? []).find(
          (v) => v.status === 'draft' || v.status === 'failed'
        );
        if (!candidate) return { status: 'no_draft_found' };
        targetId = candidate.id;
      }

      const result = await apiFetch<PatchDraftConfigResponse>(
        `videos/${targetId}/draft-config`,
        {
          method: 'PATCH',
          body: {
            patch,
            ...(clipOperations?.length ? { clipOperations } : {}),
            title,
            requeueRender,
            ...deliverTo,
          },
        }
      );

      const draft = toDraft(result.video);

      if (!requeueRender) return { status: 'patched', draft };
      if (result.rendered) return { status: 'patched_and_queued', draft };

      // The patch landed; only the re-render was refused. The old shape fused
      // these into one string ("Patch applied but re-render failed"), so a
      // caller could not tell which half had happened.
      return {
        status: 'patched_but_blocked',
        draft,
        reason: {
          kind: 'other',
          message: result.renderMessage ?? 'The re-render was not queued.',
        },
      };
    },

    async getStatus(videoId) {
      let video: VideoRecordResponse;
      try {
        video = await apiFetch<VideoRecordResponse>(`videos/${videoId}`);
      } catch (error) {
        if (error instanceof ApiFetchError && error.status === 404) {
          return { status: 'not_found', videoId };
        }
        throw error;
      }

      const title = video.title;

      switch (asLifecycleStatus(video.status)) {
        case 'ready':
          // A `ready` row with no URL is a data fault, not a playable video.
          // The port has no way to say "ready but no asset", so it says failed
          // — the one thing it must never do is hand back a completion claim
          // the caller cannot act on.
          return video.blobUrl
            ? {
                status: 'ready',
                videoId,
                title,
                url: video.blobUrl,
                thumbnailUrl: video.thumbnailUrl,
                durationMs: video.durationMs,
              }
            : {
                status: 'failed',
                videoId,
                title,
                reason: 'The render finished but produced no video file.',
              };

        case 'queued':
        case 'processing': {
          let progress = video.progress;
          let stage: string | null = null;
          try {
            const job = await apiFetch<VideoJobResponse>(
              `videos/${videoId}/job`
            );
            progress = job.progress ?? video.progress;
            stage = job.processingStage;
          } catch {
            // No job row yet — the video record's own progress is the answer.
          }
          return {
            status: video.status === 'queued' ? 'queued' : 'processing',
            videoId,
            title,
            progress,
            stage,
          };
        }

        case 'failed':
          return {
            status: 'failed',
            videoId,
            title,
            reason: video.errorMessage ?? null,
          };

        case 'draft':
          return { status: 'draft', videoId, title };

        default:
          // An unrecognised status is not a success. Report it as failed with
          // the raw value rather than guessing.
          return {
            status: 'failed',
            videoId,
            title,
            reason: `Unrecognised video status: ${video.status}`,
          };
      }
    },

    async listAvailableAssets({ serviceId, type }) {
      const path = serviceId
        ? `assets/by-service/${serviceId}`
        : `assets?${new URLSearchParams({
            ...(type ? { type } : {}),
            limit: '50',
          }).toString()}`;

      const data = await apiFetch<
        AssetResponse[] | { items?: AssetResponse[] }
      >(path);
      const raw = Array.isArray(data) ? data : (data.items ?? []);
      const assets = raw.map(toAvailableAsset);

      return {
        assets: type ? assets.filter((a) => a.type === type) : assets,
      };
    },
  };
}
