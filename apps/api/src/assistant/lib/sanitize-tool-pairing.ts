import type { Anthropic } from '@borradh-workspace/ai';

export interface SanitizeLogger {
  warn?: (message: string, ...meta: unknown[]) => void;
  log?: (message: string, ...meta: unknown[]) => void;
}

/**
 * Last-mile defense before sending `messages` to Anthropic.
 *
 * Anthropic rejects the whole turn with a 400 if any `tool_use` block isn't
 * followed by a matching `tool_result` in the immediately-next message (and
 * vice-versa for unmatched `tool_result` blocks). `convertToAnthropicMessages`
 * already runs `dropOrphanedToolUses` internally, but production has surfaced
 * conversations where orphans still slip through (root cause TBD — likely a
 * useChat client-state edge case during stream interruption). When that
 * happens, every subsequent message in the conversation 400s and the user
 * gets stuck.
 *
 * This function walks the converted messages one more time, detects any
 * remaining unpaired `tool_use` / `tool_result` blocks, logs them so we can
 * diagnose, and drops them so the request succeeds. Assistant messages that
 * end up empty after stripping orphan tool_uses are removed entirely. User
 * messages keep their non-tool content even if their tool_results are
 * stripped.
 */
export function sanitizeToolPairing(
  messages: Anthropic.MessageParam[],
  logger?: SanitizeLogger
): Anthropic.MessageParam[] {
  const orphanToolUseIds: string[] = [];
  const orphanToolResultIds: string[] = [];

  // First pass: for each assistant message, build the set of tool_result IDs
  // present in the immediately-following message. Tool_use blocks whose ID
  // isn't in that set are orphan.
  const firstPass: Anthropic.MessageParam[] = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) {
      firstPass.push(msg);
      continue;
    }

    const next = messages[i + 1];
    const matchedIds = new Set<string>();
    if (next && next.role === 'user' && Array.isArray(next.content)) {
      for (const block of next.content) {
        if (isToolResultBlock(block)) {
          const id = block.tool_use_id;
          if (typeof id === 'string') matchedIds.add(id);
        }
      }
    }

    const filtered = msg.content.filter((block) => {
      if (isToolUseBlock(block)) {
        const id = block.id;
        if (typeof id === 'string' && matchedIds.has(id)) return true;
        if (typeof id === 'string') orphanToolUseIds.push(id);
        return false;
      }
      return true;
    });

    if (filtered.length === 0) continue;
    firstPass.push({ ...msg, content: filtered });
  }

  // Second pass: build the set of valid tool_use IDs for each user message
  // (= tool_uses in the immediately-prior assistant message). Drop tool_result
  // blocks whose ID isn't in that set.
  const validIdsAfter = new Map<number, Set<string>>();
  for (let i = 0; i < firstPass.length; i++) {
    const msg = firstPass[i];
    if (msg.role !== 'assistant' || !Array.isArray(msg.content)) continue;
    const ids = new Set<string>();
    for (const block of msg.content) {
      if (isToolUseBlock(block) && typeof block.id === 'string') {
        ids.add(block.id);
      }
    }
    validIdsAfter.set(i + 1, ids);
  }

  const result = firstPass
    .map((msg, i): Anthropic.MessageParam | null => {
      if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
      const validIds = validIdsAfter.get(i) ?? new Set<string>();
      const filtered = msg.content.filter((block) => {
        if (isToolResultBlock(block)) {
          const id = block.tool_use_id;
          if (typeof id === 'string' && validIds.has(id)) return true;
          if (typeof id === 'string') orphanToolResultIds.push(id);
          return false;
        }
        return true;
      });
      if (filtered.length === 0) return null;
      return { ...msg, content: filtered };
    })
    .filter((m): m is Anthropic.MessageParam => m !== null);

  if (orphanToolUseIds.length > 0 || orphanToolResultIds.length > 0) {
    logger?.warn?.(
      'sanitizeToolPairing dropped orphan tool blocks before Anthropic call',
      {
        orphanToolUseIds,
        orphanToolResultIds,
        messageCount: messages.length,
        resultCount: result.length,
      }
    );
  }

  return result;
}

function isToolUseBlock(
  block: unknown
): block is { type: 'tool_use'; id?: string } {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: string }).type === 'tool_use'
  );
}

function isToolResultBlock(
  block: unknown
): block is { type: 'tool_result'; tool_use_id?: string } {
  return (
    typeof block === 'object' &&
    block !== null &&
    (block as { type?: string }).type === 'tool_result'
  );
}
