import { db } from '@borradh-workspace/database';
import {
  getFreshDownloadUrl,
  resolveMediaAsset,
} from '@borradh-workspace/features/meta-ads';
import type { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';
import type {
  CollectedToolEvent,
  HeadlessTurnResult,
} from './collecting-sink.js';

/**
 * `render-whatsapp-turn.ts` (WS-6) — translate a completed headless Claire turn
 * into an ORDERED list of WhatsApp sends.
 *
 * Three concerns, deliberately split so the planning logic stays pure and
 * unit-testable while the I/O (DB/S3/Meta) lives in async helpers:
 *
 *   1. {@link renderWhatsappTurn} — PURE. Takes a {@link HeadlessTurnResult} plus
 *      already-resolved per-preview media info and returns a {@link WhatsappSend}[]
 *      plan. No network, no DB. This is what the unit test exercises.
 *   2. {@link resolvePreviewMedia} — async. Resolves a draft's creative id
 *      (video / image / graphic) to an owner-authorized, fetchable URL (signed if
 *      the asset isn't already public, per plan Q10). Run this BEFORE the pure
 *      renderer and feed its output in via `opts.previewMedia`.
 *   3. {@link deliverWhatsappSends} — async executor. Walks the plan in order and
 *      calls the (real) {@link WhatsAppCloudService}. Kept thin and side-effecting.
 *
 * The worker (WS-10) is the orchestrator that wires these together — see the
 * sequence documented at the bottom of this file.
 */

/** WhatsApp body messages cap at 4096 chars; keep a small safety margin. */
const MAX_BODY_CHARS = 4000;

/** The model-emitted delimiter that splits one text block into multiple bubbles. */
const MSG_BREAK = '---MSG_BREAK---';

/** A single planned WhatsApp send. Discriminated on `kind`. */
export type WhatsappSend =
  | { kind: 'text'; body: string }
  | {
      kind: 'media';
      mediaType: 'image' | 'video';
      link: string;
      caption?: string;
    }
  | {
      kind: 'interactive_list';
      header?: string;
      body: string;
      footer?: string;
      buttonText: string;
      sections: Array<{
        title?: string;
        rows: Array<{
          id: string;
          title: string;
          description?: string;
        }>;
      }>;
    };

/**
 * Already-resolved media for a single `preview_card` tool event, keyed by the
 * tool event's `toolCallId`. Produced by {@link resolvePreviewMedia} and passed
 * into the pure renderer so it never touches DB/S3 itself.
 *
 * `media` is `null` when the draft has no usable creative yet (still being
 * collected) — the renderer then omits the media bubble but still sends the
 * text summary + CTA so the owner knows what's missing.
 */
export interface ResolvedPreviewMedia {
  toolCallId: string;
  media: { mediaType: 'image' | 'video'; link: string } | null;
}

export interface RenderWhatsappTurnOptions {
  /**
   * Resolved media for each `preview_card` tool event, keyed by `toolCallId`.
   * Optional; when a preview's media isn't present here it's treated as `null`
   * (text-only preview summary).
   */
  previewMedia?: ResolvedPreviewMedia[];
}

const PREVIEW_CTA = 'Reply *launch* to publish, or tell me what to change.';

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * Extract the bare action name from a factory-prefixed tool name.
 * `videos_listAvailableAssets` → `listAvailableAssets`
 * `listAvailableAssets` → `listAvailableAssets`
 */
function bareAction(toolName: string): string {
  if (!toolName.includes('_')) return toolName;
  return toolName.split('_').pop() ?? toolName;
}

/** A `preview_card` presentation (ad/offer) carried on a tool event. */
interface PreviewCardPresentation {
  type: 'preview_card';
  kind: 'ad' | 'offer';
  draftId: string;
  state: Record<string, unknown>;
}

function asPreviewCard(presentation: unknown): PreviewCardPresentation | null {
  if (!isRecord(presentation)) return null;
  if (presentation.type !== 'preview_card') return null;
  const kind = presentation.kind;
  if (kind !== 'ad' && kind !== 'offer') return null;
  return {
    type: 'preview_card',
    kind,
    draftId:
      typeof presentation.draftId === 'string' ? presentation.draftId : '',
    state: isRecord(presentation.state) ? presentation.state : {},
  };
}

/** The `missing[]` array a show-*-preview tool returns on its `output.data`. */
function previewMissingFields(event: CollectedToolEvent): string[] {
  const output = event.output;
  if (!isRecord(output)) return [];
  const data = isRecord(output.data) ? output.data : output;
  const missing = data.missing;
  if (Array.isArray(missing)) {
    return missing.filter((m): m is string => typeof m === 'string');
  }
  return [];
}

/**
 * Split a text block into WhatsApp bubbles: first on the model's
 * `---MSG_BREAK---` delimiter, then hard-cap each fragment at ~4096 chars,
 * splitting overlong fragments on a paragraph/line/word/char boundary.
 */
export function splitTextIntoBodies(text: string): string[] {
  const fragments = text
    .split(MSG_BREAK)
    .map((f) => f.trim())
    .filter((f) => f.length > 0);

  const bodies: string[] = [];
  for (const fragment of fragments) {
    bodies.push(...capBody(fragment));
  }
  return bodies;
}

/** Hard-cap a single fragment to <= MAX_BODY_CHARS, splitting on safe boundaries. */
function capBody(fragment: string): string[] {
  if (fragment.length <= MAX_BODY_CHARS) return [fragment];

  const out: string[] = [];
  let remaining = fragment;
  while (remaining.length > MAX_BODY_CHARS) {
    const window = remaining.slice(0, MAX_BODY_CHARS);
    // Prefer to break on the last paragraph, then newline, then space.
    let cut =
      window.lastIndexOf('\n\n') >= 0
        ? window.lastIndexOf('\n\n')
        : window.lastIndexOf('\n') >= 0
          ? window.lastIndexOf('\n')
          : window.lastIndexOf(' ');
    // No safe boundary in the window → hard cut at the limit.
    if (cut <= 0) cut = MAX_BODY_CHARS;
    out.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) out.push(remaining);
  return out;
}

function fmt(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.length > 0 ? value : null;
  if (typeof value === 'number') return String(value);
  return null;
}

/** Build the human text summary for an ad preview from its draft snapshot. */
function buildAdSummary(
  state: Record<string, unknown>,
  missing: string[]
): string {
  const lines: string[] = ['*Ad preview*'];
  const headline = fmt(state.headline);
  const caption = fmt(state.primaryText);
  const cta = fmt(state.callToAction);
  if (headline) lines.push(`Headline: ${headline}`);
  if (caption) lines.push(`Caption: ${caption}`);
  if (cta) lines.push(`Button: ${cta}`);
  if (Array.isArray(state.serviceIds) && state.serviceIds.length > 0) {
    lines.push(`Services: ${state.serviceIds.length} selected`);
  }
  const targeting = state.targeting;
  if (isRecord(targeting)) {
    const summary = summarizeTargeting(targeting);
    if (summary) lines.push(`Targeting: ${summary}`);
  }
  if (missing.length > 0) {
    lines.push('', `_Still needed: ${missing.join(', ')}_`);
  }
  return lines.join('\n');
}

function summarizeTargeting(targeting: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const radius = fmt(targeting.radiusKm ?? targeting.radius);
  if (radius) parts.push(`${radius}km radius`);
  const ageMin = fmt(targeting.ageMin);
  const ageMax = fmt(targeting.ageMax);
  if (ageMin && ageMax) parts.push(`ages ${ageMin}-${ageMax}`);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Build the human text summary for an offer preview from its draft snapshot. */
function buildOfferSummary(
  state: Record<string, unknown>,
  missing: string[]
): string {
  const lines: string[] = ['*Offer preview*'];
  const name = fmt(state.name);
  if (name) lines.push(`Name: ${name}`);
  const discountType = fmt(state.discountType);
  if (discountType === 'percentage') {
    const pct = fmt(state.discountPercent);
    if (pct) lines.push(`Discount: ${pct}% off`);
  } else if (discountType === 'fixed_price') {
    const cents = state.offerPriceCents;
    if (typeof cents === 'number') {
      lines.push(`Price: ${(cents / 100).toFixed(2)}`);
    }
  } else if (discountType === 'buy_x_get_y') {
    const buy = fmt(state.buyQuantity);
    const get = fmt(state.getQuantity);
    if (buy && get) lines.push(`Deal: buy ${buy} get ${get}`);
  }
  const validUntil = fmt(state.validUntil);
  if (validUntil) lines.push(`Valid until: ${validUntil}`);
  if (Array.isArray(state.serviceIds) && state.serviceIds.length > 0) {
    lines.push(`Services: ${state.serviceIds.length} selected`);
  }
  if (missing.length > 0) {
    lines.push('', `_Still needed: ${missing.join(', ')}_`);
  }
  return lines.join('\n');
}

/** Extract asset-list output from a `listAvailableAssets` tool event. */
function asAssetList(
  event: CollectedToolEvent
):
  | { id: string; name: string; type: string; duration: number | null }[]
  | null {
  if (bareAction(event.toolName) !== 'listAvailableAssets') return null;
  const output = event.output;
  if (!isRecord(output)) return null;
  const data = isRecord(output.data) ? output.data : output;
  const assets = data.assets;
  if (!Array.isArray(assets) || assets.length === 0) return null;
  return assets
    .filter((a: unknown): a is Record<string, unknown> => isRecord(a))
    .map((a) => ({
      id: typeof a.id === 'string' ? a.id : '',
      name: typeof a.name === 'string' ? a.name : 'Untitled',
      type: typeof a.type === 'string' ? a.type : 'video',
      duration: typeof a.duration === 'number' ? a.duration : null,
    }));
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return m > 0 ? ` (${m}m${s > 0 ? `${s}s` : ''})` : ` (${s}s)`;
}

/** Build a numbered text list of assets for WhatsApp clip selection (fallback for >10 clips). */
function buildAssetListMessage(
  assets: { id: string; name: string; type: string; duration: number | null }[]
): string {
  const lines = ['*Your clips:*', ''];
  assets.forEach((a, i) => {
    const icon = a.type === 'image' ? '🖼' : '🎬';
    lines.push(`${i + 1}. ${icon} ${a.name}${formatDuration(a.duration)}`);
  });
  lines.push('', 'Reply with the numbers you want (e.g. *1, 3, 4*).');
  return lines.join('\n');
}

/** Max rows in a WhatsApp interactive list (across all sections). */
const INTERACTIVE_LIST_MAX_ROWS = 10;

/** Build an interactive list send for WhatsApp clip selection (≤10 clips). */
function buildAssetListInteractive(
  assets: { id: string; name: string; type: string; duration: number | null }[]
): WhatsappSend {
  const rows = assets.slice(0, INTERACTIVE_LIST_MAX_ROWS).map((a, i) => {
    const rawTitle = `${i + 1}. ${a.name}`;
    const title =
      rawTitle.length <= 24 ? rawTitle : `${rawTitle.slice(0, 21)}...`;
    const icon = a.type === 'image' ? '🖼 Image' : '🎬 Video';
    const m =
      a.duration != null && a.duration > 0 ? Math.floor(a.duration / 60) : 0;
    const s =
      a.duration != null && a.duration > 0 ? Math.round(a.duration % 60) : 0;
    const dur =
      a.duration != null && a.duration > 0
        ? m > 0
          ? ` · ${m}m${s > 0 ? `${s}s` : ''}`
          : ` · ${s}s`
        : '';
    const desc = `${icon}${dur}`.slice(0, 72);
    return { id: a.id, title, description: desc };
  });

  return {
    kind: 'interactive_list',
    header: 'Your clips',
    body: 'Tap below to browse and select clips for your video. Pick one at a time, or type clip numbers (e.g. *1, 3, 4*) to select multiple.',
    buttonText: 'Browse clips',
    sections: [{ title: 'Available clips', rows }],
  };
}

/** Check whether a tool event is a graphic creation/regeneration. */
function isGraphicEvent(event: CollectedToolEvent): boolean {
  const action = bareAction(event.toolName);
  return action === 'createGraphic' || action === 'regenerateGraphic';
}

/** Extract a status line from a graphic tool event (rendering or error). */
function asGraphicStatus(event: CollectedToolEvent): string | null {
  if (!isGraphicEvent(event)) return null;
  const output = event.output;
  if (!isRecord(output)) return null;
  const data = isRecord(output.data) ? output.data : output;
  if (data.error) {
    return typeof data.error === 'string'
      ? data.error
      : 'Sorry, something went wrong creating the graphic.';
  }
  if (data.status === 'rendering') {
    return '🎨 Creating your graphic — usually ready in under a minute.';
  }
  return null;
}

/**
 * A tool event that produced or changed a video draft.
 *
 * Both are consumed HERE even though only a create carries hydrated `clips` —
 * an edit narrates and shows no carousel. That is the point of listing it: an
 * event this function does not claim falls through to the branches below and
 * gets rendered by whichever one matches loosely, so dropping `patchContent`
 * from this list would not remove a card, it would add a wrong one.
 */
function isVideoDraftEvent(event: CollectedToolEvent): boolean {
  const action = bareAction(event.toolName);
  return action === 'createDraftVideo' || action === 'patchContent';
}

/** Extract hydrated clip details from a video draft tool event. */
function asVideoDraftClips(
  event: CollectedToolEvent
):
  | { id: string; name: string; type: string; duration: number | null }[]
  | null {
  if (!isVideoDraftEvent(event)) return null;
  const output = event.output;
  if (!isRecord(output)) return null;
  const data = isRecord(output.data) ? output.data : output;
  const clips = data.clips;
  if (!Array.isArray(clips) || clips.length === 0) return null;
  return clips
    .filter((c: unknown): c is Record<string, unknown> => isRecord(c))
    .map((c) => ({
      id: typeof c.id === 'string' ? c.id : '',
      name: typeof c.name === 'string' ? c.name : 'Clip',
      type: typeof c.type === 'string' ? c.type : 'video',
      duration: typeof c.duration === 'number' ? c.duration : null,
    }));
}

/** Build an interactive list showing the clips selected for a video draft. */
function buildDraftClipsInteractive(
  clips: { id: string; name: string; type: string; duration: number | null }[]
): WhatsappSend {
  const rows = clips.slice(0, INTERACTIVE_LIST_MAX_ROWS).map((c, i) => {
    const rawTitle = `${i + 1}. ${c.name}`;
    const title =
      rawTitle.length <= 24 ? rawTitle : `${rawTitle.slice(0, 21)}...`;
    const icon = c.type === 'image' ? '🖼 Image' : '🎬 Video';
    const m =
      c.duration != null && c.duration > 0 ? Math.floor(c.duration / 60) : 0;
    const s =
      c.duration != null && c.duration > 0 ? Math.round(c.duration % 60) : 0;
    const dur =
      c.duration != null && c.duration > 0
        ? m > 0
          ? ` · ${m}m${s > 0 ? `${s}s` : ''}`
          : ` · ${s}s`
        : '';
    const desc = `${icon}${dur}`.slice(0, 72);
    return { id: c.id, title, description: desc };
  });

  return {
    kind: 'interactive_list',
    header: 'Clips in your video',
    body: `These ${clips.length} clip${clips.length === 1 ? '' : 's'} will be used. Reply to swap or reorder.`,
    buttonText: 'View clips',
    sections: [{ title: 'Selected clips', rows }],
  };
}

/** Extract a video-ready event from `getVideoStatus` with status=ready and a blobUrl. */
function asVideoReady(
  event: CollectedToolEvent
): { blobUrl: string; title: string } | null {
  if (bareAction(event.toolName) !== 'getVideoStatus') return null;
  const output = event.output;
  if (!isRecord(output)) return null;
  const data = isRecord(output.data) ? output.data : output;
  if (data.status !== 'ready') return null;
  const blobUrl = typeof data.blobUrl === 'string' ? data.blobUrl : null;
  if (!blobUrl) return null;
  return {
    blobUrl,
    title: typeof data.title === 'string' ? data.title : 'Video',
  };
}

/** Extract a video processing status from `getVideoStatus` when not ready. */
function asVideoProcessing(event: CollectedToolEvent): string | null {
  if (bareAction(event.toolName) !== 'getVideoStatus') return null;
  const output = event.output;
  if (!isRecord(output)) return null;
  const data = isRecord(output.data) ? output.data : output;
  if (data.status === 'ready') return null;
  const status = typeof data.status === 'string' ? data.status : 'unknown';
  const progress =
    typeof data.progress === 'number' ? `${Math.round(data.progress)}%` : null;
  const stage =
    typeof data.processingStage === 'string' ? data.processingStage : null;
  const parts = [`Status: ${status}`];
  if (progress) parts.push(`Progress: ${progress}`);
  if (stage) parts.push(`Stage: ${stage}`);
  return `*Video render*\n${parts.join('\n')}`;
}

/** Detect a `renderVideo` success event. */
function asVideoQueued(event: CollectedToolEvent): boolean {
  if (bareAction(event.toolName) !== 'renderVideo') return false;
  const output = event.output;
  if (!isRecord(output)) return false;
  const data = isRecord(output.data) ? output.data : output;
  return data.status === 'queued' && !data.error;
}

/**
 * PURE: translate a completed headless turn into an ordered WhatsApp send plan.
 *
 * Ordering rule: text segments and tool previews are emitted in the order the
 * turn produced them. We walk `textSegments` and `toolEvents` together, keyed by
 * the fact that the model typically emits its narration text then the preview
 * tool. For each `preview_card` tool event we emit: media (if resolved)
 * then a text summary then the launch CTA. Web-only presentations (tours, dispatchTour) and tool
 * errors degrade to a short text line or are omitted.
 *
 * No network / DB access — resolved media is supplied via `opts.previewMedia`.
 */
export function renderWhatsappTurn(
  result: HeadlessTurnResult,
  opts: RenderWhatsappTurnOptions = {}
): WhatsappSend[] {
  const sends: WhatsappSend[] = [];
  const mediaByCallId = new Map<string, ResolvedPreviewMedia>();
  for (const m of opts.previewMedia ?? []) mediaByCallId.set(m.toolCallId, m);

  // 1. Check if tool events will produce interactive lists (clip carousel /
  // asset picker). When they do, the narration text ("Here are your clips",
  // "Here's your draft") is redundant — the interactive list already has a
  // descriptive header and body. Emitting both causes double messages.
  const toolEventsProduceInteractive = result.toolEvents.some((event) => {
    if (event.errorText) return false;
    const assets = asAssetList(event);
    if (assets && assets.length <= INTERACTIVE_LIST_MAX_ROWS) return true;
    if (isVideoDraftEvent(event)) {
      const clips = asVideoDraftClips(event);
      if (
        clips &&
        clips.length > 0 &&
        clips.length <= INTERACTIVE_LIST_MAX_ROWS
      )
        return true;
    }
    return false;
  });

  // Assistant narration → text bubbles. Merge all segments into one block —
  // the model often narrates before AND after tool calls, and on WhatsApp
  // those should be a single bubble. Skip entirely when an interactive list
  // will carry the content (avoids the text + carousel double-message).
  if (!toolEventsProduceInteractive) {
    const fullNarration = result.textSegments.join('\n\n').trim();
    if (fullNarration.length > 0) {
      for (const body of splitTextIntoBodies(fullNarration)) {
        sends.push({ kind: 'text', body });
      }
    }
  }

  // 2. Tool outputs → rendered per presentation type.
  for (const event of result.toolEvents) {
    if (event.errorText) continue;

    // 2a. Asset list → interactive list for ≤10 clips, text fallback for more.
    const assets = asAssetList(event);
    if (assets) {
      if (assets.length <= INTERACTIVE_LIST_MAX_ROWS) {
        sends.push(buildAssetListInteractive(assets));
      } else {
        for (const body of capBody(buildAssetListMessage(assets))) {
          sends.push({ kind: 'text', body });
        }
      }
      continue;
    }

    // 2b. Graphic creation/regeneration → status text (image arrives async).
    const graphicStatus = asGraphicStatus(event);
    if (graphicStatus) {
      sends.push({ kind: 'text', body: graphicStatus });
      continue;
    }

    // 2c. Video draft → clip carousel (model narration already covers the summary).
    if (isVideoDraftEvent(event)) {
      const clips = asVideoDraftClips(event);
      if (
        clips &&
        clips.length > 0 &&
        clips.length <= INTERACTIVE_LIST_MAX_ROWS
      ) {
        sends.push(buildDraftClipsInteractive(clips));
      }
      continue;
    }

    // 2d. Video ready → send the video as media.
    const ready = asVideoReady(event);
    if (ready) {
      sends.push({
        kind: 'media',
        mediaType: 'video',
        link: ready.blobUrl,
        caption: `✅ ${ready.title}`,
      });
      continue;
    }

    // 2e. Video processing → status text.
    const processing = asVideoProcessing(event);
    if (processing) {
      sends.push({ kind: 'text', body: processing });
      continue;
    }

    // 2f. Video export queued → the text narration covers it, skip the tool output.
    if (asVideoQueued(event)) continue;

    // 2g. Ad/offer preview → media + summary + CTA.
    const preview = asPreviewCard(event.presentation);
    if (!preview) continue;

    const resolved = mediaByCallId.get(event.toolCallId);
    if (resolved?.media) {
      sends.push({
        kind: 'media',
        mediaType: resolved.media.mediaType,
        link: resolved.media.link,
      });
    }

    const missing = previewMissingFields(event);
    const summary =
      preview.kind === 'ad'
        ? buildAdSummary(preview.state, missing)
        : buildOfferSummary(preview.state, missing);
    for (const body of capBody(summary)) {
      sends.push({ kind: 'text', body });
    }

    sends.push({ kind: 'text', body: PREVIEW_CTA });
  }

  return sends;
}

/**
 * The creative-id field on an ad draft snapshot (video, image, or graphic id —
 * all resolvable through {@link resolveMediaAsset}).
 */
function previewCreativeId(preview: PreviewCardPresentation): string | null {
  if (preview.kind !== 'ad') return null;
  const videoId = preview.state.videoId;
  return typeof videoId === 'string' && videoId.length > 0 ? videoId : null;
}

/**
 * Async: resolve the creative for every `preview_card` (ad) tool event in the
 * turn to a fresh, owner-authorized, fetchable URL (signed if the underlying
 * asset isn't public — see {@link getFreshDownloadUrl}, plan Q10).
 *
 * Offers carry no creative, so they resolve to `media: null` (text-only
 * summary). Ads whose creative is still being collected (no `videoId`) likewise
 * resolve to `null`. Resolution failures degrade to `null` rather than throwing
 * so a single bad asset never sinks the whole reply.
 *
 * Call this BEFORE {@link renderWhatsappTurn} and pass the output via
 * `opts.previewMedia`.
 */
export async function resolvePreviewMedia(
  result: HeadlessTurnResult,
  deps: {
    resolveMediaAsset: typeof resolveMediaAsset;
    getFreshDownloadUrl: typeof getFreshDownloadUrl;
  } = {
    resolveMediaAsset,
    getFreshDownloadUrl,
  }
): Promise<ResolvedPreviewMedia[]> {
  const out: ResolvedPreviewMedia[] = [];
  for (const event of result.toolEvents) {
    if (event.errorText) continue;
    const preview = asPreviewCard(event.presentation);
    if (!preview) continue;

    const creativeId = previewCreativeId(preview);
    if (!creativeId) {
      out.push({ toolCallId: event.toolCallId, media: null });
      continue;
    }

    try {
      const resolved = await deps.resolveMediaAsset(
        db,
        creativeId,
        'Ad creative'
      );
      if (!resolved.success) {
        out.push({ toolCallId: event.toolCallId, media: null });
        continue;
      }
      const link = await deps.getFreshDownloadUrl(resolved.data.mediaBlobUrl);
      out.push({
        toolCallId: event.toolCallId,
        media: { mediaType: resolved.data.assetType, link },
      });
    } catch {
      out.push({ toolCallId: event.toolCallId, media: null });
    }
  }
  return out;
}

/**
 * Async executor: deliver a planned send list in order via the real
 * {@link WhatsAppCloudService}. Kept thin and side-effecting; the planning is
 * pure (above). Owner-initiated turns keep the 24h window open, so non-template
 * text + media sends are allowed (WS-7).
 */
export async function deliverWhatsappSends(
  service: Pick<
    WhatsAppCloudService,
    'sendTextMessage' | 'sendMediaMessage' | 'sendInteractiveMessage'
  >,
  to: string,
  sends: WhatsappSend[]
): Promise<void> {
  for (const send of sends) {
    if (send.kind === 'text') {
      await service.sendTextMessage(to, send.body);
    } else if (send.kind === 'media') {
      await service.sendMediaMessage(to, {
        type: send.mediaType,
        link: send.link,
        ...(send.caption ? { caption: send.caption } : {}),
      });
    } else if (send.kind === 'interactive_list') {
      await service.sendInteractiveMessage(to, {
        type: 'list',
        header: send.header,
        body: send.body,
        footer: send.footer,
        buttonText: send.buttonText,
        sections: send.sections,
      });
    }
  }
}

/* ------------------------------------------------------------------------- *
 * WS-10 worker sequence (the orchestration this file is built for)
 * ------------------------------------------------------------------------- *
 *
 * Per inbound WhatsApp message from a paired owner, the worker runs:
 *
 *   1. Build turn inputs (WS-5):
 *        const inputs = await buildClaireTurnInputs(db, {
 *          orgContext, organizationId, userId, conversationId,
 *          channel: 'whatsapp', loadedSkillIds, knowledgeContext, cookie: '',
 *          hasPendingConfirmation: conv.pendingConfirmation != null,
 *        });
 *
 *   2. Run the engine with a CollectingSink (WS-1/WS-2):
 *        const sink = new CollectingSink();
 *        const runResult = await runClaireTurn({
 *          client, model: inputs.model, system: inputs.system,
 *          initialMessages, toolMap: inputs.toolMap, toolCtx: inputs.toolCtx,
 *          maxTokens: inputs.maxTokens, sink, logger,
 *          onSkillsChanged: (ids) => ({
 *            toolMap: inputs.buildToolMap(ids),
 *            system: inputs.buildSystemBlocks(ids),
 *          }),
 *        });
 *
 *   3. Assemble the rich result (WS-2):
 *        const result = assembleHeadlessTurnResult(sink.collected, runResult);
 *
 *   4. Resolve preview media (this file, async, DB/S3):
 *        const previewMedia = await resolvePreviewMedia(result);
 *
 *   5. Plan the sends (this file, PURE):
 *        const sends = renderWhatsappTurn(result, { previewMedia });
 *
 *   6. Persist the confirmation gate (WS-8) for any preview shown, so the
 *      owner's "launch" reply on the NEXT turn satisfies the destructive gate.
 *      For each `preview_card` (ad/offer) tool event in `result.toolEvents`:
 *        await setPendingConfirmation(db, {
 *          conversationId, organizationId,
 *          kind: preview.kind,            // 'ad' | 'offer'  (from the presentation)
 *          draftId: preview.draftId,      // from the presentation
 *        });
 *      (If multiple previews appear, the last one wins — typically there is one.)
 *      WS-10 owns this DB write; the pure renderer never touches the DB.
 *
 *   7. Deliver (this file, async, Meta API):
 *        await deliverWhatsappSends(whatsappCloudService, ownerPhoneE164, sends);
 *
 * Media URL resolution (step 4): an ad draft snapshot's `state.videoId` holds
 * the creative id (a video, asset, OR graphic id — `resolveMediaAsset` probes
 * all three tables). `getFreshDownloadUrl` then mints a fresh presigned/signed
 * URL that WhatsApp can fetch (the org-asset CDN/S3 URL is re-signed with a 1h
 * TTL). Offers carry no creative → `media: null` → text-only summary.
 */
