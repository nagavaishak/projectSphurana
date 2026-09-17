import type { Anthropic } from '@borradh-workspace/ai';
import type { UIMessage } from 'ai';

export interface ConvertOptions {
  /**
   * Hosts (lower-cased) we allow as the source for image URL content blocks.
   * The controller computes this from `S3_ASSISTANT_UPLOADS_BUCKET` + region
   * + optional `CDN_URL` and passes it in. Image parts whose URL host is
   * outside this list are silently dropped — keeps Anthropic from fetching
   * attacker-controlled URLs (cost abuse + external request logging) when a
   * UIMessage is forged client-side.
   *
   * Pass `undefined` (or an empty array) to disable the check — appropriate
   * for test fixtures that don't have S3 wired up.
   */
  allowedImageHosts?: readonly string[];
}

/**
 * Returns true if the URL's host appears in `allowedHosts`. Pass through
 * (no enforcement) when the allowlist is empty — see `ConvertOptions`.
 */
function isImageUrlAllowed(
  url: string,
  allowedHosts?: readonly string[]
): boolean {
  if (!allowedHosts || allowedHosts.length === 0) return true;
  let host: string;
  try {
    host = new URL(url).host.toLowerCase();
  } catch {
    return false;
  }
  return allowedHosts.some((allowed) => host === allowed.toLowerCase());
}

/**
 * Convert AI SDK `UIMessage[]` (the wire format the frontend `useChat` posts)
 * into Anthropic SDK `MessageParam[]` (what `client.messages.stream({ messages })`
 * accepts).
 *
 * Mapping:
 *   - `text` parts            → `{ type: 'text', text }`
 *   - `tool-<name>` parts     → assistant `tool_use` block + matching user
 *                               `tool_result` block (UIMessage carries both
 *                                input and output on the same part)
 *   - `reasoning` parts       → `{ type: 'thinking', thinking, signature }`
 *                                (preserves prior-turn extended-thinking output
 *                                 when the model re-reads its own reasoning)
 *   - file part w/ image      → URL image content block (W-C11; non-image
 *     mediaType / `image` part    file parts dropped — v3 attachments are
 *                                 image-only)
 *
 * The factory's confirmation flow round-trips entirely through the
 * `tool-<name>` part shape — first call's output is the
 * `confirmation_required` payload; the second call's output is the executed
 * action result. Both are carried in the part's `output` field, so this
 * converter doesn't need any special-case for them.
 *
 * Empty assistant messages (no text, no tool calls) are filtered — Anthropic
 * rejects empty `content` arrays.
 *
 * @see {@link https://platform.claude.com/docs/en/build-with-claude/tool-use Anthropic tool use docs}
 */
export function convertToAnthropicMessages(
  uiMessages: readonly UIMessage[],
  options?: ConvertOptions
): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];

  for (const message of uiMessages) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      // System messages live in the `system` parameter on the request body,
      // not in `messages`. Drop them.
      continue;
    }

    let assistantBlocks: Anthropic.ContentBlockParam[] = [];
    const userBlocks: Anthropic.ContentBlockParam[] = [];
    let toolResultBlocks: Anthropic.ContentBlockParam[] = [];

    /**
     * Flush the in-progress step as an assistant turn followed by a synthetic
     * user turn carrying its tool_results. Used at every `step-start` boundary
     * within an assistant message AND at the end of the message — Anthropic
     * requires every `tool_use` to be answered in the IMMEDIATELY following
     * user message, so multi-step server-side tool loops (e.g. round 1 →
     * tool_use(A) + result, round 2 → tool_use(B) + result) must not be
     * collapsed into a single assistant turn with text interleaved between
     * the rounds. (W-bug 2026-04-26: 3-tool conversation hit
     * `messages.7: tool_use ids without tool_result` because all rounds were
     * being merged.)
     */
    const flushAssistantStep = () => {
      if (message.role !== 'assistant') return;
      if (assistantBlocks.length > 0) {
        out.push({ role: 'assistant', content: assistantBlocks });
      }
      if (toolResultBlocks.length > 0) {
        out.push({ role: 'user', content: toolResultBlocks });
      }
      assistantBlocks = [];
      toolResultBlocks = [];
    };

    for (const part of message.parts ?? []) {
      // Step boundary (assistant only). Each `step-start` opens a new round
      // of the server-side tool loop — every prior tool_use in this assistant
      // message has already been answered before the next round began, so
      // we close the current step out as its own assistant→user pair.
      if (part.type === 'step-start' && message.role === 'assistant') {
        flushAssistantStep();
        continue;
      }

      // Text — either user or assistant.
      if (part.type === 'text') {
        const target =
          message.role === 'assistant' ? assistantBlocks : userBlocks;
        if (typeof part.text === 'string' && part.text.length > 0) {
          target.push({ type: 'text', text: part.text });
        }
        continue;
      }

      // Reasoning (assistant-only). Anthropic accepts the thinking block
      // back as input on subsequent requests; doing so preserves continuity
      // when the model re-reads its own chain-of-thought.
      if (part.type === 'reasoning' && message.role === 'assistant') {
        const thinking = (part as { text?: string }).text;
        const signature = (
          part as { providerMetadata?: { anthropic?: { signature?: string } } }
        ).providerMetadata?.anthropic?.signature;
        if (
          typeof thinking === 'string' &&
          thinking.length > 0 &&
          typeof signature === 'string'
        ) {
          assistantBlocks.push({
            type: 'thinking',
            thinking,
            signature,
          });
        }
        continue;
      }

      // Tool parts. UIMessage encodes both the call and the result on the
      // same part; we split them into the assistant turn's `tool_use` block
      // and the next user turn's `tool_result` block.
      //
      // Anthropic requires every `tool_use` to be followed by a matching
      // `tool_result` in the next message. A tool part still in
      // `input-streaming` / `input-available` (e.g. a confirmation tool the
      // user navigated away from before approving, or a stream that was
      // interrupted mid-call) has no output yet — emitting only the
      // `tool_use` would make Anthropic reject the next turn. We skip both
      // sides of the pair so the orphan disappears from history; the model
      // can re-decide based on the user's new message.
      if (part.type.startsWith('tool-')) {
        const toolName = part.type.replace(/^tool-/, '');
        const toolPart = part as unknown as {
          toolCallId?: string;
          input?: unknown;
          output?: unknown;
          state?: string;
          errorText?: string;
        };
        const toolCallId = toolPart.toolCallId;
        if (!toolCallId) continue;

        const hasOutput =
          toolPart.state === 'output-available' ||
          toolPart.state === 'output-error';
        if (!hasOutput) continue;

        if (message.role === 'assistant') {
          assistantBlocks.push({
            type: 'tool_use',
            id: toolCallId,
            name: toolName,
            input: (toolPart.input ?? {}) as Record<string, unknown>,
          });
        }

        const isError = toolPart.state === 'output-error';
        const content = isError
          ? (toolPart.errorText ?? 'Tool execution failed.')
          : JSON.stringify(toolPart.output ?? {});
        toolResultBlocks.push({
          type: 'tool_result',
          tool_use_id: toolCallId,
          content,
          ...(isError ? { is_error: true } : {}),
        });
        continue;
      }

      // Image attachments (W-C11). Frontend posts a `file` part with a
      // signed S3 download URL and an `image/*` mediaType. Non-image file
      // parts (PDFs, other) are dropped — v3 explicitly scopes attachments
      // to images only (claire.md §2). A bare `image` part type without an
      // explicit mediaType is also accepted for forward-compat.
      const partWithUrl = part as {
        type: string;
        url?: string;
        mediaType?: string;
      };
      const isImagePart =
        (part.type === 'file' &&
          typeof partWithUrl.mediaType === 'string' &&
          partWithUrl.mediaType.startsWith('image/')) ||
        partWithUrl.type === 'image';
      if (isImagePart && typeof partWithUrl.url === 'string') {
        // Drop image parts pointing at hosts we don't recognise. The signed
        // upload pipeline only ever produces URLs on the assistant-uploads
        // bucket (or the configured CDN); an external URL means a forged
        // UIMessage and we don't want Anthropic fetching attacker-controlled
        // content on our behalf.
        if (!isImageUrlAllowed(partWithUrl.url, options?.allowedImageHosts)) {
          continue;
        }
        const target =
          message.role === 'assistant' ? assistantBlocks : userBlocks;
        target.push({
          type: 'image',
          source: { type: 'url', url: partWithUrl.url },
        });
      }
    }

    // Emit assistant turn — flush the final (or only) step. Multi-step
    // assistant messages have already had earlier steps emitted at each
    // `step-start` boundary above; this picks up whatever's left.
    if (message.role === 'assistant') {
      flushAssistantStep();
    }

    // Emit user turn — first the user's own text/image content, then any
    // tool_result blocks that came back from the prior assistant's tool calls.
    if (message.role === 'user') {
      const combined: Anthropic.ContentBlockParam[] = [
        ...userBlocks,
        ...toolResultBlocks,
      ];
      if (combined.length > 0) {
        out.push({ role: 'user', content: combined });
      }
    }
  }

  return dropOrphanedToolUses(out);
}

/**
 * Final safety pass: Anthropic rejects any `tool_use` whose ID isn't matched
 * by a `tool_result` in the *next* message. Even with the per-part skip in
 * the main loop, orphans can still slip through (e.g. UIMessage shapes from
 * older clients, future AI SDK state additions, or a confirmation flow that
 * landed an `output-available` block here but a downstream user turn that
 * doesn't carry the matching `tool_result`). We re-walk the converted
 * messages, drop any unmatched `tool_use` blocks, and prune assistant turns
 * that become empty as a result. The corresponding `tool_result` blocks (if
 * any landed without a matching `tool_use`) are also dropped.
 */
function dropOrphanedToolUses(
  messages: Anthropic.MessageParam[]
): Anthropic.MessageParam[] {
  const result: Anthropic.MessageParam[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) {
      result.push(msg);
      continue;
    }

    const next = messages[i + 1];
    const matchedIds = new Set<string>();
    if (next && next.role === 'user' && Array.isArray(next.content)) {
      for (const block of next.content) {
        if (
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: string }).type === 'tool_result'
        ) {
          const id = (block as { tool_use_id?: string }).tool_use_id;
          if (typeof id === 'string') matchedIds.add(id);
        }
      }
    }

    const filtered = msg.content.filter((block) => {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: string }).type === 'tool_use'
      ) {
        const id = (block as { id?: string }).id;
        return typeof id === 'string' && matchedIds.has(id);
      }
      return true;
    });

    if (filtered.length === 0) continue;
    result.push({ ...msg, content: filtered });
  }

  // Drop tool_result blocks whose tool_use was not in the prior message.
  const validIdsByIndex = new Map<number, Set<string>>();
  for (let i = 0; i < result.length; i++) {
    const msg = result[i];
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    const ids = new Set<string>();
    for (const block of msg.content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: string }).type === 'tool_use'
      ) {
        const id = (block as { id?: string }).id;
        if (typeof id === 'string') ids.add(id);
      }
    }
    validIdsByIndex.set(i + 1, ids);
  }

  return result
    .map((msg, i) => {
      if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
      const validIds = validIdsByIndex.get(i) ?? new Set<string>();
      const filtered = msg.content.filter((block) => {
        if (
          typeof block === 'object' &&
          block !== null &&
          (block as { type?: string }).type === 'tool_result'
        ) {
          const id = (block as { tool_use_id?: string }).tool_use_id;
          return typeof id === 'string' && validIds.has(id);
        }
        return true;
      });
      if (filtered.length === 0) return null;
      return { ...msg, content: filtered };
    })
    .filter((m): m is Anthropic.MessageParam => m !== null);
}
