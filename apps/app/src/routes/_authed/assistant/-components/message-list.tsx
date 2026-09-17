import type { UIMessage } from 'ai';
import { Bot } from 'lucide-react';
import { useMemo } from 'react';

import {
  Attachment,
  AttachmentPreview,
  Attachments,
} from '@/components/ai-elements/attachments';
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation';
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@/components/ai-elements/reasoning';
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from '@/components/ai-elements/sources';
import {
  CONFIRMATION_TOOLS,
  SILENT_TOOLS,
  type ToolPartData,
  asToolPart,
  getToolName,
  isToolPartVisible as isToolPartVisibleShared,
} from '@/features/assistant';
import { cn } from '@/lib/utils';

import {
  MemoryRecallBadge,
  type MemoryRecallBadgePayload,
} from '@/features/assistant/_components/rich/memory-recall-badge';
import { ToolRenderer } from '@/features/assistant/_components/tool-renderer';
import { StreamErrorBanner } from './error-states';
import { ToolTrace } from './tool-trace';

interface MessageListProps {
  messages: UIMessage[];
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  error: Error | null;
  onSendMessage: (text: string) => void;
  onRetry: () => void;
}

export function MessageList({
  messages,
  status,
  error,
  onSendMessage,
  onRetry,
}: MessageListProps) {
  return (
    <Conversation className="min-h-0 flex-1">
      <ConversationContent className="mx-auto w-full max-w-3xl gap-4 px-4 py-4 sm:px-6 sm:py-6">
        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            isStreaming={
              status === 'streaming' &&
              message === messages[messages.length - 1]
            }
            onSendMessage={onSendMessage}
          />
        ))}

        {status === 'submitted' && <ThinkingIndicator />}

        {error && status === 'error' && (
          <StreamErrorBanner message={error.message} onRetry={onRetry} />
        )}
      </ConversationContent>
      <ConversationScrollButton aria-label="Scroll to bottom" />
    </Conversation>
  );
}

interface MessageBubbleProps {
  message: UIMessage;
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
}

function MessageBubble({
  message,
  isStreaming,
  onSendMessage,
}: MessageBubbleProps) {
  const isUser = message.role === 'user';

  const {
    textParts,
    toolParts,
    reasoningParts,
    sourceParts,
    fileParts,
    memoryRecallParts,
  } = useMemo(() => bucketParts(message.parts), [message.parts]);

  // Q25a: auto-expand reasoning when a destructive confirmation is pending.
  const hasPendingConfirmation = toolParts.some(
    (tp) =>
      CONFIRMATION_TOOLS.has(getToolName(tp)) && tp.state !== 'output-available'
  );

  const hasReasoning = reasoningParts.length > 0;
  const reasoningStreaming =
    isStreaming &&
    hasReasoning &&
    reasoningParts.some((p) => isStreamingReasoning(p));

  const hasVisibleAssistantContent =
    textParts.length > 0 ||
    toolParts.some((tp) =>
      isToolPartVisible(tp, message.role === 'assistant')
    ) ||
    hasReasoning ||
    sourceParts.length > 0 ||
    fileParts.length > 0 ||
    memoryRecallParts.length > 0;

  const renderPart = (part: UIMessage['parts'][number], i: number) => {
    if (part.type === 'text') {
      if (isUser) {
        return (
          <p key={`${message.id}-text-${i}`} className="whitespace-pre-wrap">
            {part.text}
          </p>
        );
      }
      return (
        <MessageResponse
          key={`${message.id}-text-${i}`}
          // ChatGPT-style dot cursor while this text block streams in
          // (streamdown appends it after the last rendered block).
          caret="circle"
          isAnimating={isStreaming && i === message.parts.length - 1}
        >
          {part.text}
        </MessageResponse>
      );
    }

    const tp = asToolPart(part);
    if (!tp) return null;

    const toolName = getToolName(tp);
    // A tool can be in SILENT_TOOLS (no chain-of-thought trace badge) and
    // *still* produce a rich output that should render — e.g.
    // `createDraftVideo` returns `uiState: 'created'` and is meant to mount
    // the CreatedCard via the generic dispatch in ToolRenderer. Only silence
    // the part when its output has no interactive shape (no `uiState`).
    const out = tp.output as { uiState?: unknown } | undefined;
    const hasInteractiveOutput =
      out && typeof out === 'object' && 'uiState' in out;
    if (
      SILENT_TOOLS.has(toolName) &&
      tp.state === 'output-available' &&
      !hasInteractiveOutput
    ) {
      return null;
    }

    return (
      <ToolRenderer
        key={`${tp.toolCallId}-${i}`}
        toolName={toolName}
        toolPart={tp}
        onSendMessage={onSendMessage}
      />
    );
  };

  return (
    <Message from={message.role}>
      <MessageContent
        className={cn(
          message.role === 'assistant' && 'min-w-0 max-w-[95%] gap-3'
        )}
      >
        {/* Image attachments (W-C11) — render before text/tool output so the
            visual order matches what Anthropic vision sees (image content
            blocks precede text in `convert-to-anthropic-messages`). */}
        {fileParts.length > 0 && (
          <Attachments className="mb-1" variant="grid">
            {fileParts.map((fp, i) => (
              <Attachment
                key={`${message.id}-file-${i}`}
                data={{
                  type: 'file',
                  id: `${message.id}-file-${i}`,
                  mediaType: fp.mediaType,
                  url: fp.url,
                  filename: fp.filename,
                }}
              >
                <AttachmentPreview />
              </Attachment>
            ))}
          </Attachments>
        )}

        {/* Reasoning — collapsed by default; auto-expand on destructive. */}
        {!isUser && hasReasoning && (
          <Reasoning
            isStreaming={reasoningStreaming}
            defaultOpen={hasPendingConfirmation}
          >
            <ReasoningTrigger />
            <ReasoningContent>{joinReasoning(reasoningParts)}</ReasoningContent>
          </Reasoning>
        )}

        {/* Tool trace — only when there are tool calls. */}
        {!isUser && toolParts.length > 0 && <ToolTrace parts={message.parts} />}

        {/* Text + rich tool parts in original order. Consecutive draft-ad
            cards (the campaign builds a video ad + a graphic ad back-to-back)
            are laid out side by side in a row instead of stacked. */}
        {groupParts(message.parts).map((unit) =>
          unit.kind === 'ad-row' ? (
            <div
              key={`adrow-${unit.items[0].index}`}
              className="flex flex-col gap-3 sm:flex-row sm:items-start"
            >
              {unit.items.map(({ part, index }) => (
                <div
                  key={`${message.id}-adcell-${index}`}
                  className="min-w-0 flex-1"
                >
                  {renderPart(part, index)}
                </div>
              ))}
            </div>
          ) : (
            renderPart(unit.part, unit.index)
          )
        )}

        {/* Memory-recall badges — render below text, before sources, so the
            "Claire remembered…" chip sits as a footer on the message body
            without dominating it. Gated on backend emit (no-op today). */}
        {!isUser && memoryRecallParts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {memoryRecallParts.map((payload) => (
              <MemoryRecallBadge
                key={payload.knowledgeEntryId}
                payload={payload}
              />
            ))}
          </div>
        )}

        {/* Sources — render below the message body. */}
        {!isUser && sourceParts.length > 0 && (
          <Sources>
            <SourcesTrigger count={sourceParts.length} />
            <SourcesContent>
              {sourceParts.map((src, i) => (
                <Source
                  key={`${message.id}-src-${i}`}
                  href={src.url}
                  title={src.title ?? src.url}
                />
              ))}
            </SourcesContent>
          </Sources>
        )}

        {/* Streaming turns open with non-visible parts (e.g. `step-start`)
            before the first text delta lands — show the typing dot for that
            beat instead of flashing "No content". */}
        {!isUser &&
          !hasVisibleAssistantContent &&
          (isStreaming ? (
            <TypingDot />
          ) : (
            <p className="italic text-muted-foreground">No content</p>
          ))}
      </MessageContent>
    </Message>
  );
}

/** ChatGPT-style pulsing dot — shown while Claire streams with nothing visible yet. */
function TypingDot() {
  return (
    <span
      aria-label="Claire is typing"
      className="inline-block animate-pulse select-none leading-none"
    >
      ●
    </span>
  );
}

function ThinkingIndicator() {
  return (
    <Message from="assistant">
      <MessageContent>
        <div className="flex items-center gap-2 rounded-lg bg-muted px-4 py-2.5 text-sm text-muted-foreground">
          <Bot className="size-4" />
          <div className="flex gap-1">
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:150ms]" />
            <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:300ms]" />
          </div>
          <span>Thinking...</span>
        </div>
      </MessageContent>
    </Message>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ReasoningPartLike {
  type: string;
  text?: string;
  state?: string;
}

interface SourcePartLike {
  type: string;
  url: string;
  title?: string;
}

interface FilePartLike {
  type: 'file';
  url: string;
  mediaType: string;
  filename?: string;
}

interface BucketedParts {
  textParts: UIMessage['parts'];
  toolParts: ToolPartData[];
  reasoningParts: ReasoningPartLike[];
  sourceParts: SourcePartLike[];
  fileParts: FilePartLike[];
  memoryRecallParts: MemoryRecallBadgePayload[];
}

/**
 * Parse a `data-memory_recalled` part into a badge payload, or return
 * null if the shape doesn't match. Defensive — the controller doesn't
 * emit these today (W-C14-frontend, 2026-04-26 gate); shape-checking
 * keeps the renderer safe when a future emit-side window lands.
 */
function asMemoryRecallPart(
  part: UIMessage['parts'][number]
): MemoryRecallBadgePayload | null {
  if (part.type !== 'data-memory_recalled') return null;
  const data = (part as unknown as { data?: unknown }).data;
  if (!data || typeof data !== 'object') return null;
  const { knowledgeEntryId, content, scope } = data as {
    knowledgeEntryId?: unknown;
    content?: unknown;
    scope?: unknown;
  };
  if (typeof knowledgeEntryId !== 'string' || knowledgeEntryId.length === 0) {
    return null;
  }
  if (typeof content !== 'string' || content.length === 0) return null;
  if (scope !== 'personal' && scope !== 'organization') return null;
  return { knowledgeEntryId, content, scope };
}

type PartRenderUnit =
  | { kind: 'single'; part: UIMessage['parts'][number]; index: number }
  | {
      kind: 'ad-row';
      items: { part: UIMessage['parts'][number]; index: number }[];
    };

/**
 * A part that renders nothing — the campaign flow's offer video / graphic
 * creatives (created with `suppressCard`) and the silent `previewCampaign`
 * read. These sit between the `createDraftAd` cards in the part stream, so they
 * must be transparent to the ad-row clustering below — otherwise they break the
 * run and the three ad cards fall back to stacked singles.
 */
function isInvisibleCampaignPart(part: UIMessage['parts'][number]): boolean {
  const tp = asToolPart(part);
  if (!tp) return false;
  const name = getToolName(tp);
  if (
    name !== 'createDraftVideo' &&
    name !== 'createAdGraphic' &&
    name !== 'previewCampaign'
  ) {
    return false;
  }
  return Boolean(
    (tp.input as { suppressCard?: boolean } | undefined)?.suppressCard
  );
}

/**
 * Group the message parts for rendering, clustering runs of two-or-more
 * `createDraftAd` cards into a single `ad-row` unit so the campaign flow's
 * video ad + two graphic ads sit side by side instead of stacked. Suppressed
 * creative parts (the offer video / graphics, which render nothing) are skipped
 * when extending the run, so interleaved create→draft-ad sequences still
 * cluster. A lone draft ad (or any other visible part) stays a `single`.
 */
function groupParts(parts: UIMessage['parts']): PartRenderUnit[] {
  const units: PartRenderUnit[] = [];

  for (let i = 0; i < parts.length; i++) {
    const tp = asToolPart(parts[i]);
    if (tp && getToolName(tp) === 'createDraftAd') {
      const items = [{ part: parts[i], index: i }];
      let lastAd = i;
      let j = i + 1;
      while (j < parts.length) {
        const nextTp = asToolPart(parts[j]);
        if (nextTp && getToolName(nextTp) === 'createDraftAd') {
          items.push({ part: parts[j], index: j });
          lastAd = j;
          j++;
        } else if (isInvisibleCampaignPart(parts[j])) {
          // Transparent creative between two ad cards — skip, keep scanning.
          j++;
        } else {
          break;
        }
      }
      if (items.length >= 2) {
        units.push({ kind: 'ad-row', items });
        // Consume through the last ad; any skipped invisible parts in between
        // render nothing, so dropping them from the unit list is lossless.
        i = lastAd;
        continue;
      }
      units.push({
        kind: 'single',
        part: items[0].part,
        index: items[0].index,
      });
      continue;
    }
    units.push({ kind: 'single', part: parts[i], index: i });
  }

  return units;
}

function bucketParts(parts: UIMessage['parts']): BucketedParts {
  const textParts: UIMessage['parts'] = [];
  const toolParts: ToolPartData[] = [];
  const reasoningParts: ReasoningPartLike[] = [];
  const sourceParts: SourcePartLike[] = [];
  const fileParts: FilePartLike[] = [];
  const memoryRecallParts: MemoryRecallBadgePayload[] = [];

  for (const part of parts) {
    if (part.type === 'text') {
      textParts.push(part);
      continue;
    }

    const tp = asToolPart(part);
    if (tp) {
      toolParts.push(tp);
      continue;
    }

    // C-02 may emit these once the new wire format ships.
    if (part.type === 'reasoning') {
      reasoningParts.push(part as unknown as ReasoningPartLike);
      continue;
    }

    if (part.type === 'source-url' || part.type === 'source-document') {
      sourceParts.push(part as unknown as SourcePartLike);
      continue;
    }

    // Memory recall (W-C14-frontend, 2026-04-26). Gated — the controller
    // does NOT emit `data-memory_recalled` parts as of v3 launch; this
    // branch is dead code that activates once a future window wires the
    // emit side from `assistant-chat.controller.ts`'s queryKnowledge
    // call. See `rich/memory-recall-badge.tsx` for context.
    const memoryRecall = asMemoryRecallPart(part);
    if (memoryRecall) {
      memoryRecallParts.push(memoryRecall);
      continue;
    }

    // Image file parts (W-C11). Only render when the part has both a URL
    // and an image/* mediaType — defensive against partially-formed parts
    // (e.g., during stream-in or from a future provider).
    if (part.type === 'file') {
      const fp = part as unknown as {
        url?: string;
        mediaType?: string;
        filename?: string;
      };
      if (
        typeof fp.url === 'string' &&
        typeof fp.mediaType === 'string' &&
        fp.mediaType.startsWith('image/')
      ) {
        fileParts.push({
          type: 'file',
          url: fp.url,
          mediaType: fp.mediaType,
          filename: fp.filename,
        });
      }
    }
  }

  return {
    textParts,
    toolParts,
    reasoningParts,
    sourceParts,
    fileParts,
    memoryRecallParts,
  };
}

function joinReasoning(parts: ReasoningPartLike[]): string {
  return parts.map((p) => p.text ?? '').join('');
}

function isStreamingReasoning(p: ReasoningPartLike): boolean {
  return p.state === 'streaming';
}

/**
 * A CARD ANSWERS FOR ITSELF — see the shared implementation.
 *
 * This was a third copy of the rule, still gated on a tool-name list. So the
 * fix that made `executeLaunchAd`'s confirmation visible landed in one of the
 * two chats and not the one this route renders, and "confirm on the card" was
 * said over nothing for the third time. Delegated rather than re-fixed: the
 * same rule written out twice is the reason it was wrong here.
 */
function isToolPartVisible(tp: ToolPartData, isAssistant: boolean): boolean {
  if (!isAssistant) return false;
  if (isToolPartVisibleShared(tp, true)) return true;
  // Local escape hatch kept: a tool can be silent in the trace and still carry
  // a `uiState` output that mounts a generic CreatedCard / CreatingStatus.
  const out = tp.output as { uiState?: unknown } | undefined;
  return Boolean(out && typeof out === 'object' && 'uiState' in out);
}
