import type { Anthropic } from '@borradh-workspace/ai';
import type { FileUIPart, UIMessage } from 'ai';
import {
  type ConvertOptions,
  convertToAnthropicMessages,
} from './convert-to-anthropic-messages.js';
import {
  type SanitizeLogger,
  sanitizeToolPairing,
} from './sanitize-tool-pairing.js';

/**
 * A persisted `assistant_message` row, as loaded by the
 * `getConversationMessages` feature service. The JSONB columns are typed
 * `unknown` because they round-trip arbitrary shapes; we rebuild them
 * defensively below.
 */
export interface StoredMessageRow {
  id: string;
  role: string;
  content: string | null;
  toolCalls: unknown;
  toolResults: unknown;
  attachments: unknown;
  createdAt: Date;
}

interface PersistedToolPart {
  toolCallId: string;
  toolName: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
}

/**
 * Rebuild AI SDK v5 tool parts from a persisted `toolCalls` JSONB blob.
 *
 * Server-side mirror of `convertStoredToUIMessages`/`extractToolParts` in
 * `apps/app` — the WhatsApp worker has no client to resend the thread, so it
 * reconstructs the same `tool-<name>` part shapes the web client would have
 * posted, then funnels them through the identical
 * `convertToAnthropicMessages` + `sanitizeToolPairing` pipeline. Keeping the
 * shapes identical preserves `tool_use`/`tool_result` pairing fidelity.
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

/** Server-side mirror of `extractFileParts` in `apps/app`. */
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

/** Rebuild stored rows into the `UIMessage[]` the web client would have sent. */
function storedToUIMessages(stored: readonly StoredMessageRow[]): UIMessage[] {
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
        parts: [...fileParts, ...toolParts, ...textParts],
      } satisfies UIMessage;
    });
}

/**
 * Convert persisted `assistant_message` rows into Anthropic `MessageParam[]`
 * for use as prior-turn history in a headless (worker) Claire turn.
 *
 * Reuses the exact web converters so worker behaviour matches the web chat:
 *   stored rows → UIMessage[] → convertToAnthropicMessages → sanitizeToolPairing.
 *
 * Anthropic requires the first message to be a user turn. A history window can
 * begin on an assistant row (e.g. the tail starts mid-exchange), so we strip
 * any leading non-user messages from the result. The caller appends the new
 * inbound user message after this history.
 */
export function convertStoredToAnthropicMessages(
  stored: readonly StoredMessageRow[],
  options?: ConvertOptions & { logger?: SanitizeLogger }
): Anthropic.MessageParam[] {
  const ui = storedToUIMessages(stored);
  const converted = sanitizeToolPairing(
    convertToAnthropicMessages(ui, options),
    options?.logger
  );

  // Drop leading assistant turns so history starts on a user turn.
  let start = 0;
  while (start < converted.length && converted[start].role !== 'user') {
    start++;
  }
  return converted.slice(start);
}
