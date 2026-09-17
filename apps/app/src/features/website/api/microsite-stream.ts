import type { MicrositeStreamEvent } from './types';

/**
 * SSE frame parsing for the editor turn stream (§4).
 *
 * Same transport as Claire (`lib/sse-sink.ts` on the API side, the reader loop
 * in `campaign-composer.tsx` on this side) — `data:` frames separated by a
 * blank line, one JSON object per frame. Pulled out of the hook because the
 * frame handling is the part with real logic (partial chunks, multi-line
 * frames, a `[DONE]` sentinel) and it is worth testing without a component.
 */

/** Parse one complete SSE frame into an event, or `null` if it carries none. */
export function parseSseFrame(frame: string): MicrositeStreamEvent | null {
  const data = frame
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .join('\n')
    .trim();

  if (!data || data === '[DONE]') return null;

  try {
    const parsed = JSON.parse(data) as MicrositeStreamEvent;
    // A frame without a recognised `type` is a protocol mismatch, not text to
    // render. Dropping it is right; rendering `[object Object]` in the
    // transcript is how "the model ignored me" bugs get reported.
    return parsed && typeof parsed.type === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Read an SSE body to completion, handing each decoded event to `onEvent`.
 *
 * Resolves when the stream ends. Does not throw on a malformed frame — a bad
 * frame is skipped, because half a turn rendered is better than a blank panel.
 */
export async function consumeMicrositeStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: MicrositeStreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      // The trailing element is an incomplete frame — keep it buffered.
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const event = parseSseFrame(frame);
        if (event) onEvent(event);
      }
    }
    const tail = parseSseFrame(buffer);
    if (tail) onEvent(tail);
  } finally {
    reader.releaseLock();
  }
}

/**
 * Tools that mutate irreversibly enough to demand a confirmation (§3).
 *
 * The contract puts a confirmation flag on the tool result, and the sidebar
 * honours it — but it ALSO checks this list, because §3's whole point is that
 * the guardrail is enforced in code rather than trusted to the model. If the
 * flag is missing the confirmation still happens.
 */
const DESTRUCTIVE_TOOLS = new Set(['delete_page', 'update_theme']);

export function isDestructiveTool(name: string): boolean {
  return DESTRUCTIVE_TOOLS.has(name);
}

/**
 * Human-readable fallback for a tool activity line.
 *
 * The API sends `summary` ("Added a testimonials section") and that is what the
 * transcript shows. This is only for a tool event that arrives without one —
 * the transcript must NEVER render raw JSON args at the user.
 */
const TOOL_FALLBACK_LABELS: Record<string, string> = {
  list_pages: 'Looked over the pages',
  read_page: 'Read a page',
  add_block: 'Added a section',
  update_block: 'Edited a section',
  move_block: 'Moved a section',
  delete_block: 'Removed a section',
  create_page: 'Created a page',
  delete_page: 'Deleted a page',
  update_theme: 'Updated the theme',
  update_seo: 'Updated the page SEO',
  search_org_assets: 'Looked through your photos',
  generate_image: 'Generated an image',
  preview: 'Refreshed the preview',
};

export function toolSummary(name: string, summary?: string): string {
  const trimmed = summary?.trim();
  if (trimmed) return trimmed;
  return TOOL_FALLBACK_LABELS[name] ?? 'Worked on your website';
}
