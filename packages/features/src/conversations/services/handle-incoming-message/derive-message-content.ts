import type {
  ConversationMessageAttachment,
  ConversationMessageMetadata,
} from '@borradh-workspace/database';

/**
 * Message types persisted on `conversation_message.message_type`. Mirrors the
 * `message_type` pg enum (text | image | quick_reply | template | attachment).
 */
export type DerivedMessageType = 'text' | 'image' | 'attachment';

/**
 * Meta's thumbs-up "like" sticker id. Sent as a sticker attachment when a user
 * taps the like button in Messenger / Instagram DMs.
 * @see https://developers.facebook.com/docs/messenger-platform/reference/webhook-events/messages
 */
export const META_LIKE_STICKER_ID = '369239263222822';

/**
 * Normalized, platform-agnostic view of an inbound (or backfilled) Meta
 * message, before we decide how to store/display it. Built from either a live
 * webhook `message` object or a Conversations-API history message.
 */
export interface RawMetaMessage {
  /** The text body, if any. */
  text?: string | null;
  /** Raw Meta attachments (live webhook or history `attachments.data`). */
  attachments?: Array<{
    type?: string | null;
    payload?: {
      url?: string | null;
      sticker_id?: number | string | null;
      title?: string | null;
    } | null;
    /** History shape: image_data holds the URL instead of payload. */
    image_data?: { url?: string | null; preview_url?: string | null } | null;
  }> | null;
  /** Sticker id (live webhook attachment `sticker_id`, or flattened). */
  stickerId?: number | string | null;
  /** Sticker image URL (history `sticker` field exposes a URL, not an id). */
  stickerUrl?: string | null;
  /** Emoji character for a message reaction. */
  reaction?: string | null;
}

/**
 * What to persist for a message: a never-blank display `content`, the
 * `messageType` enum value, and structured `metadata` (null for plain text).
 */
export interface DerivedMessageContent {
  content: string;
  messageType: DerivedMessageType;
  metadata: ConversationMessageMetadata | null;
}

const ATTACHMENT_LABELS: Record<ConversationMessageAttachment['type'], string> =
  {
    image: '📷 Photo',
    video: '🎥 Video',
    audio: '🎤 Voice message',
    file: '📎 File',
    share: '🔗 Shared link',
    fallback: '🔗 Shared link',
    story_mention: '📖 Mentioned you in their story',
    story_reply: '📖 Replied to your story',
    unknown: '📎 Attachment',
  };

/**
 * Map a raw Meta attachment `type` string onto our normalized union. Meta uses
 * `image | video | audio | file | fallback | template | story_mention | share`;
 * anything unrecognized falls back to `unknown` so it stays visible rather than
 * disappearing.
 */
function normalizeAttachmentType(
  rawType: string | null | undefined
): ConversationMessageAttachment['type'] {
  switch ((rawType ?? '').toLowerCase()) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'file':
      return 'file';
    case 'share':
      return 'share';
    case 'fallback':
      return 'fallback';
    case 'story_mention':
      return 'story_mention';
    case 'story_reply':
      return 'story_reply';
    default:
      return 'unknown';
  }
}

function pickUrl(
  a: NonNullable<RawMetaMessage['attachments']>[number]
): string | undefined {
  return (
    a.payload?.url ??
    a.image_data?.url ??
    a.image_data?.preview_url ??
    undefined
  );
}

interface PickedSticker {
  stickerId?: string;
  stickerUrl?: string;
  isLike: boolean;
}

function pickSticker(raw: RawMetaMessage): PickedSticker | null {
  const stickerAttachment = raw.attachments?.find(
    (a) => a?.payload?.sticker_id != null
  );
  const rawId = raw.stickerId ?? stickerAttachment?.payload?.sticker_id ?? null;
  const stickerId =
    rawId != null && `${rawId}`.trim() !== '' ? `${rawId}` : undefined;
  const urlCandidate =
    raw.stickerUrl ?? stickerAttachment?.payload?.url ?? null;
  const stickerUrl =
    urlCandidate != null && `${urlCandidate}`.trim() !== ''
      ? `${urlCandidate}`
      : undefined;

  if (!stickerId && !stickerUrl) return null;
  return {
    ...(stickerId ? { stickerId } : {}),
    ...(stickerUrl ? { stickerUrl } : {}),
    isLike: stickerId === META_LIKE_STICKER_ID,
  };
}

/**
 * Derive the persisted form of an inbound/backfilled Meta message.
 *
 * Guarantees:
 * - `content` is NEVER empty/whitespace — non-text messages get a human label
 *   (e.g. "📷 Photo", "👍", "[Message]") so the inbox never shows a blank bubble.
 * - `metadata` captures structured sticker/reaction/attachment data, or `null`
 *   for a plain text message (keeps the common path clean).
 * - `messageType` reflects the dominant kind for rendering decisions.
 *
 * Precedence for `content`: real text → reaction emoji → like → sticker →
 * first attachment label → generic fallback.
 */
export function deriveMessageContent(
  raw: RawMetaMessage
): DerivedMessageContent {
  const text = raw.text?.trim() ? raw.text.trim() : '';

  const attachments: ConversationMessageAttachment[] = (raw.attachments ?? [])
    .filter((a): a is NonNullable<typeof a> => a != null)
    // A pure sticker arrives as an attachment too; we capture it via stickerId
    // below, so don't also list it as a generic attachment.
    .filter((a) => a.payload?.sticker_id == null)
    .map((a) => {
      const type = normalizeAttachmentType(a.type);
      const url = pickUrl(a);
      const title = a.payload?.title ?? undefined;
      return {
        type,
        ...(url ? { url } : {}),
        ...(title ? { title } : {}),
      };
    });

  const sticker = pickSticker(raw);
  const reaction = raw.reaction?.trim() ? raw.reaction.trim() : undefined;

  const metadata: ConversationMessageMetadata = {};
  if (attachments.length > 0) metadata.attachments = attachments;
  if (sticker) {
    if (sticker.stickerId) metadata.stickerId = sticker.stickerId;
    if (sticker.stickerUrl) metadata.stickerUrl = sticker.stickerUrl;
    if (sticker.isLike) metadata.isLike = true;
  }
  if (reaction) metadata.reaction = reaction;
  const hasMetadata = Object.keys(metadata).length > 0;

  // messageType: a single image → 'image'; any other media/sticker → 'attachment';
  // otherwise text.
  let messageType: DerivedMessageType = 'text';
  if (attachments.length > 0) {
    messageType =
      attachments.length === 1 && attachments[0].type === 'image'
        ? 'image'
        : 'attachment';
  } else if (sticker) {
    messageType = 'attachment';
  }

  // content precedence (never blank).
  let content: string;
  if (text) {
    content = text;
  } else if (reaction) {
    content = reaction;
  } else if (sticker) {
    content = sticker.isLike ? '👍' : '[Sticker]';
  } else if (attachments.length > 0) {
    content = ATTACHMENT_LABELS[attachments[0].type];
  } else {
    content = '[Message]';
  }

  return {
    content,
    messageType,
    metadata: hasMetadata ? metadata : null,
  };
}

/**
 * Loose structural shape of a Conversations-API (history) message, enough to
 * normalize it. Mirrors `MetaConversationMessage` without importing it, so the
 * helper stays a pure unit.
 */
export interface MetaHistoryMessageLike {
  message?: string | null;
  sticker?: string | null;
  attachments?: {
    data?: Array<{
      mime_type?: string | null;
      name?: string | null;
      image_data?: { url?: string | null; preview_url?: string | null } | null;
      video_data?: { url?: string | null } | null;
      file_url?: string | null;
    }> | null;
  } | null;
  shares?: {
    data?: Array<{ link?: string | null; name?: string | null }> | null;
  } | null;
}

/**
 * Convert a Conversations-API history message into the platform-agnostic
 * `RawMetaMessage` consumed by `deriveMessageContent`. The history attachment
 * shape (image_data / video_data / file_url / mime_type) differs from the live
 * webhook shape, so we normalize it here.
 */
export function metaHistoryToRaw(msg: MetaHistoryMessageLike): RawMetaMessage {
  const attachments: NonNullable<RawMetaMessage['attachments']> = [];

  for (const a of msg.attachments?.data ?? []) {
    if (a == null) continue;
    const url =
      a.image_data?.url ??
      a.image_data?.preview_url ??
      a.video_data?.url ??
      a.file_url ??
      undefined;
    const mime = a.mime_type ?? '';
    // Only call it a 'file' when there's an actual file payload (file_url or a
    // mime type). A Click-to-Messenger ad referral comes back from the
    // Conversations history API as an attachment with NO image_data/video_data/
    // file_url and an empty mime — those used to fall through to 'file' and
    // render as a misleading "📎 File" bubble. Classify those as 'unknown'
    // ("📎 Attachment") instead.
    const type = a.video_data
      ? 'video'
      : a.image_data || mime.startsWith('image/')
        ? 'image'
        : mime.startsWith('video/')
          ? 'video'
          : mime.startsWith('audio/')
            ? 'audio'
            : a.file_url || mime
              ? 'file'
              : 'unknown';
    attachments.push({
      type,
      payload: { url, title: a.name ?? undefined },
    });
  }

  for (const s of msg.shares?.data ?? []) {
    if (s == null) continue;
    attachments.push({
      type: 'share',
      payload: { url: s.link ?? undefined, title: s.name ?? undefined },
    });
  }

  return {
    text: msg.message ?? undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    stickerUrl: msg.sticker ?? undefined,
  };
}

/**
 * Is this inbound message effectively empty — i.e. carries no text, attachment,
 * sticker or reaction? Used to skip read-receipt / typing / reaction-removed
 * events that should not create or update a conversation.
 */
export function isEmptyMetaMessage(raw: RawMetaMessage): boolean {
  const hasText = !!raw.text?.trim();
  const hasReaction = !!raw.reaction?.trim();
  const hasSticker = pickSticker(raw) != null;
  const hasAttachment = (raw.attachments ?? []).some(
    (a) => a != null && a.payload?.sticker_id == null
  );
  return !hasText && !hasReaction && !hasSticker && !hasAttachment;
}
