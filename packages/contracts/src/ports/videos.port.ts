/**
 * Videos capability port.
 *
 * Pilot for the ports pattern — chosen because `createDraftVideo` is the
 * most-violated contract in production: it returned `{ rendered: true,
 * status: 'queued' }` 47 times, and Claire truthfully relayed "your video is
 * rendering" for videos that never rendered.
 *
 * The types below make that sentence unwriteable. `rendered` does not exist,
 * and no state that merely *accepted* a render carries a URL or a completion
 * claim.
 *
 * A note on what this port models: `queued` means the render request was
 * ACCEPTED by the queue — nothing more. The only state that asserts a playable
 * asset is `ready`, and it cannot be constructed without a `url`.
 */

/** Video lifecycle, mirroring `videoStatusLabels` in `@borradh-workspace/labels`. */
export type VideoLifecycleStatus =
  | 'draft'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'failed';

/**
 * Why a draft cannot be CREATED. Distinct from `RenderBlockedReason` — the
 * first draft of this port fused the two, but they come from different code
 * paths: creation blockers are raised while synthesising the draft config
 * (missing tagged media, unknown offer), render blockers while queueing an
 * existing draft.
 */
export type CreateBlockedReason =
  | { kind: 'missing_before_after_media'; missing: ('before' | 'after')[] }
  | { kind: 'offer_not_found'; offerId: string }
  | { kind: 'service_not_found'; serviceId: string }
  /**
   * The server refused for a stated reason this union does not name yet. The
   * message is carried verbatim: an adapter must never squeeze an unrecognised
   * refusal into a `kind` that claims to know more than it does.
   */
  | { kind: 'other'; message: string }
  /**
   * The server FAULTED — this is not a refusal the owner can act on. Kept
   * separate from `other` so callers can alert on it without alerting on every
   * ordinary "no, because…". */
  | { kind: 'server_error'; message: string };

/**
 * Why a render cannot be QUEUED. Every named case here is one
 * `queueVideoExport` in `packages/features/src/videos` actually raises.
 */
export type RenderBlockedReason =
  | { kind: 'video_not_found'; videoId: string }
  | { kind: 'not_a_draft'; currentStatus: VideoLifecycleStatus | 'unknown' }
  | { kind: 'incomplete_config'; detail: string }
  | { kind: 'b_roll_transcode_failed' }
  | { kind: 'b_roll_still_processing' }
  /** A stated refusal this union does not name yet; message carried verbatim. */
  | { kind: 'other'; message: string }
  /** The server faulted. Not a refusal — worth alerting on. */
  | { kind: 'server_error'; message: string };

export interface VideoTextFrame {
  id: string;
  text: string;
  style?: 'default' | 'question' | 'answer' | 'disclaimer' | 'cta';
}

/** A created draft, as an orchestrator needs to describe it back to the owner. */
export interface VideoDraft {
  videoId: string;
  title: string;
  templateId?: string;
  variationId?: string;
  serviceId?: string;
  scriptText?: string;
  orientation?: string;
  narrationType?: string;
  /** Selected b-roll, in render order. Empty is legitimate (stock auto-fill). */
  clipAssetIds: string[];
  /** On-screen copy for text-only narration. Empty for other narration types. */
  textFrames: VideoTextFrame[];
  /**
   * The content item that owns this video.
   *
   * The ITEM is what an edit addresses, because editing a rendered video forks
   * it and the item is what follows the fork. It comes back from `POST /videos`
   * now that creating a video opens one; before that, three tools each reached
   * past HTTP into the database to adopt an item after the fact, and only two of
   * them remembered to.
   *
   * Null when the item could not be opened. The video still exists, so the
   * caller degrades rather than treating the create as failed.
   */
  itemId?: string | null;
  /**
   * Which cut this is — 0 on a fresh create.
   */
  attemptNumber?: number | null;
  /**
   * The attempt row. A card in the transcript stamps itself with this and
   * compares it to the item's LIVE cut on every mount, which is how it knows
   * it has been superseded. Without the stamp every card for an item stays
   * live: render the video, reload the page, and the original proposal is still
   * offering Accept over a cut that no longer exists.
   */
  attemptId?: string | null;
}

/**
 * Draft-creation outcome.
 *
 * NOTE what is absent: no `rendered` boolean, and no state that both creates
 * and claims completion. Compare the shape this replaces —
 * `{ rendered: true, status: 'queued' }`, returned 47 times in production.
 *
 * `draft_render_refused` exists because the old shape collapsed that case into
 * `{ rendered: false, error }`, which reads as total failure even though the
 * draft was created and is patchable.
 */
export type CreateDraftResult =
  /** Created. Nothing was queued — the default, awaiting the owner's go-ahead. */
  | { status: 'draft'; draft: VideoDraft }
  /** Created AND the render request was accepted. Not rendered. Not playable. */
  | { status: 'queued'; draft: VideoDraft }
  /** Created, but the requested render was refused. The draft still exists. */
  | {
      status: 'draft_render_refused';
      draft: VideoDraft;
      reason: RenderBlockedReason;
    }
  /** Not created at all. There is no draft to speak about. */
  | { status: 'blocked'; reason: CreateBlockedReason };

/** Export outcome. `queued` never implies a playable asset. */
export type ExportResult =
  | { status: 'queued'; videoId: string }
  | { status: 'blocked'; videoId: string; reason: RenderBlockedReason };

/**
 * Patch outcome. Production fused two facts into one success string — "Patch
 * applied but re-render failed" — so a caller could not tell whether the patch
 * had landed. Split so both facts survive independently.
 */
export type PatchResult =
  /** Patch landed; no re-render was asked for. */
  | { status: 'patched'; draft: VideoDraft }
  /** Patch landed and the re-render was accepted. */
  | { status: 'patched_and_queued'; draft: VideoDraft }
  /** Patch landed; the re-render was refused. Both facts survive. */
  | {
      status: 'patched_but_blocked';
      draft: VideoDraft;
      reason: RenderBlockedReason;
    }
  /** Nothing was patched — there was no draft to patch. */
  | { status: 'no_draft_found' };

/**
 * Render progress.
 *
 * `ready` cannot be constructed without a `url`, so the shape this replaces —
 * `{ status: 'ready', blobUrl: null }` — is unrepresentable.
 */
export type VideoStatusResult =
  | { status: 'draft'; videoId: string; title: string }
  | {
      status: 'queued' | 'processing';
      videoId: string;
      title: string;
      progress: number | null;
      stage: string | null;
    }
  | {
      status: 'ready';
      videoId: string;
      title: string;
      url: string;
      thumbnailUrl: string | null;
      durationMs: number | null;
    }
  | { status: 'failed'; videoId: string; title: string; reason: string | null }
  | { status: 'not_found'; videoId: string };

export interface VideoDraftRequest {
  serviceId: string;
  format?: string;
  /** Explicit backend template id. Overrides `format` when supplied. */
  templateId?: string;
  /** Required when `format` is `offer`. */
  offerId?: string;
  title?: string;
  offerCopy?: {
    headline?: string;
    bulletPoints?: string[];
    ctaText?: string;
    urgencyText?: string;
  };
  /** Queue the render immediately after creating. Defaults to false. */
  autoRender?: boolean;
  /**
   * Paid ad vs organic social post.
   *
   * Load-bearing beyond the label: an ORGANIC request with no `format` lets the
   * server rotate through the organic templates, which is what stops every
   * "make me an organic video" coming back as the same layout.
   */
  usageType?: 'ad' | 'organic';
}

export interface AvailableAsset {
  id: string;
  name: string;
  /** `video` | `image` in practice; kept open because the column is free-form. */
  type: string;
  duration: number | null;
  blobUrl: string | null;
  /**
   * Poster frame for the clip. Carried separately from `blobUrl` because a
   * grid tile has to paint from an `<img>`, and `blobUrl` is the `.mp4`.
   */
  thumbnailUrl: string | null;
  /** Free-form tag list. Absent tags are `[]`, never `null` or `undefined`. */
  tags: string[];
}

/**
 * The videos capability as an orchestrator (Claire) may use it.
 *
 * Adding a method here breaks the `apps/api` composition root until a concrete
 * implementation exists — that is Gate 2. The interface is also the single
 * reviewable list of what Claire can do with videos, rather than behaviour
 * inferred from thirteen scattered tool files.
 */
export interface VideosPort {
  createDraft(req: VideoDraftRequest): Promise<CreateDraftResult>;
  export(videoId: string): Promise<ExportResult>;
  patchDraft(input: {
    /** Omit to target the org's most recent patchable draft. */
    videoId?: string;
    patch: Record<string, unknown>;
    /**
     * Named clip edits, applied server-side against the STORED clip list.
     *
     * Separate from `patch` because `patch.bRollClips` replaces the array
     * wholesale: a caller holding a partial view of the clips — which Claire
     * always is, since she has no read of `bRollClips` at all — could only
     * change one clip by resending every clip, silently dropping the rest.
     */
    clipOperations?: (
      | { op: 'swap'; assetId: string; index?: number; targetAssetId?: string }
      | { op: 'remove'; index?: number; targetAssetId?: string }
    )[];
    title?: string;
    /** Re-queue the render after patching. Defaults to true. */
    requeueRender?: boolean;
  }): Promise<PatchResult>;
  getStatus(videoId: string): Promise<VideoStatusResult>;
  /**
   * Uploaded assets, including images. Currently reachable only under a
   * `videos_` tool namespace while also serving graphics, which is why Claire
   * never used it for graphics work and 0 of 471 graphics ever used a
   * customer's own image.
   */
  listAvailableAssets(input: {
    serviceId?: string;
    type?: 'video' | 'image';
  }): Promise<{ assets: AvailableAsset[] }>;
}
