import type { FileUIPart, UIMessage } from 'ai';
import type { StoredMessage } from '../types';

/**
 * Convert stored messages from the database to UIMessage format
 * for use as initial messages in the useChat hook.
 *
 * Only user and assistant messages are included — system and tool
 * messages are filtered out as useChat manages tool state internally.
 *
 * Image attachments (W-C11): if a stored message has an `attachments`
 * jsonb column with image entries, they're emitted as `file` parts so the
 * inline image renderer in `message-list.tsx` and the backend's
 * `convert-to-anthropic-messages` can both pick them up. Today's
 * `save-messages.service.ts` does NOT yet write to the column — the
 * round-trip is forward-compatible only. After a page reload, in-session
 * uploaded images currently disappear from chat history; the user-message
 * text is preserved. See window-c11-frontend Handoff for follow-up.
 *
 * Tool parts: the backend persists `runToolLoop`'s `toolParts` (each
 * `{ toolCallId, toolName, input, output?, errorText? }`) into the
 * `toolCalls` JSONB column. On hydration we rebuild AI SDK v5
 * `tool-<toolName>` parts so the assistant chat shows preview cards,
 * loading tiles, and result cards exactly as it did before refresh.
 */
export function convertStoredToUIMessages(
  stored: StoredMessage[]
): UIMessage[] {
  return stored
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      const fileParts = extractFileParts(m.attachments);
      const toolParts = extractToolParts(m.toolCalls);
      const textParts: UIMessage['parts'] = m.content
        ? [{ type: 'text' as const, text: m.content }]
        : [];
      return {
        id: m.id,
        role: m.role as 'user' | 'assistant',
        // Order: images first (vision parts), then tool parts (preview
        // cards / loading tiles), then text response. Matches the live
        // streaming order.
        parts: [...fileParts, ...toolParts, ...textParts],
        createdAt: new Date(m.createdAt),
      };
    });
}

interface PersistedToolPart {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
}

/**
 * Defensively rebuild AI SDK v5 tool parts from the persisted
 * `toolCalls` JSONB column. Each entry must have at least `toolCallId`
 * and `toolName`; anything missing those is dropped silently (rather
 * than crashing the whole conversation load).
 *
 * The hydrated state mirrors the live-stream state: `output-available`
 * when `output` exists, `output-error` when `errorText` exists,
 * otherwise `input-available` (the tool fired but never completed —
 * shouldn't happen for persisted rows, but we handle it gracefully).
 */
function extractToolParts(toolCalls: unknown): UIMessage['parts'] {
  if (!Array.isArray(toolCalls)) return [];
  const out: UIMessage['parts'] = [];
  for (const entry of toolCalls) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Partial<PersistedToolPart>;
    if (typeof e.toolCallId !== 'string' || typeof e.toolName !== 'string') {
      continue;
    }
    const partType = `tool-${e.toolName}` as `tool-${string}`;
    if (typeof e.errorText === 'string') {
      out.push({
        type: partType,
        toolCallId: e.toolCallId,
        state: 'output-error',
        input: e.input,
        errorText: e.errorText,
      } as unknown as UIMessage['parts'][number]);
    } else if (e.output !== undefined) {
      out.push({
        type: partType,
        toolCallId: e.toolCallId,
        state: 'output-available',
        input: e.input,
        output: e.output,
      } as unknown as UIMessage['parts'][number]);
    } else {
      out.push({
        type: partType,
        toolCallId: e.toolCallId,
        state: 'input-available',
        input: e.input,
      } as unknown as UIMessage['parts'][number]);
    }
  }
  return out;
}

/**
 * Defensively extract image file parts from a stored `attachments` jsonb
 * blob. Accepts the array form `[{ type: 'file', url, mediaType, filename? }]`
 * and shrugs at anything else — unknown shapes round-trip as no parts
 * rather than crashing the chat load.
 */
function extractFileParts(attachments: unknown): FileUIPart[] {
  if (!Array.isArray(attachments)) return [];
  const out: FileUIPart[] = [];
  for (const entry of attachments) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    if (e.type !== 'file') continue;
    if (typeof e.url !== 'string') continue;
    if (typeof e.mediaType !== 'string') continue;
    if (!e.mediaType.startsWith('image/')) continue;
    out.push({
      type: 'file',
      url: e.url,
      mediaType: e.mediaType,
      ...(typeof e.filename === 'string' ? { filename: e.filename } : {}),
    });
  }
  return out;
}
