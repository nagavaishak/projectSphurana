import type { UIMessage } from 'ai';
import { Bot } from 'lucide-react';
import { useEffect, useMemo } from 'react';

import {
  Attachment,
  AttachmentPreview,
  Attachments,
} from '@/components/ai-elements/attachments';
import { MessageResponse } from '@/components/ai-elements/message';
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
import { Bubble, BubbleContent } from '@/components/ui/bubble';
import { Message, MessageContent } from '@/components/ui/message';
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '@/components/ui/message-scroller';
import { cn } from '@/lib/utils';

import {
  CompactMessageBubble,
  CompactThinkingIndicator,
} from './ask-ai-compact-message-bubble';
import { StreamErrorBanner } from './error-states';
import {
  MemoryRecallBadge,
  type MemoryRecallBadgePayload,
} from './rich/memory-recall-badge';
import {
  CONFIRMATION_TOOLS,
  SILENT_TOOLS,
  type ToolPartData,
  asToolPart,
  getToolName,
  isToolPartVisible,
} from './tool-parts';
import { ToolRenderer } from './tool-renderer';
import { ToolTrace } from './tool-trace';

interface MessageListProps {
  messages: UIMessage[];
  status: 'submitted' | 'streaming' | 'ready' | 'error';
  error: Error | null;
  onSendMessage: (text: string) => void;
  onRetry: () => void;
  /** Mobile Ask AI sheet — tighter scroll padding and message density. */
  compact?: boolean;
  /** Bumps when the mobile composer resizes; keeps the list pinned to the bottom. */
  composerLayoutVersion?: number;
}

export function MessageList({
  messages,
  status,
  error,
  onSendMessage,
  onRetry,
  compact = false,
  composerLayoutVersion,
}: MessageListProps) {
  return (
    <MessageScrollerProvider autoScroll defaultScrollPosition="end">
      <MessageScroller className="min-h-0 flex-1">
        <MessageScrollerViewport>
          <MessageScrollerContent
            className={cn(
              'mx-auto w-full max-w-3xl',
              compact
                ? 'max-w-none gap-2.5 px-0 py-3'
                : 'gap-4 px-4 py-4 sm:px-6 sm:py-6'
            )}
          >
            {messages.map((message) => (
              <MessageScrollerItem
                key={message.id}
                messageId={message.id}
                scrollAnchor={message.role === 'user'}
              >
                {compact ? (
                  <CompactMessageBubble
                    message={message}
                    isStreaming={
                      status === 'streaming' &&
                      message === messages[messages.length - 1]
                    }
                    onSendMessage={onSendMessage}
                  />
                ) : (
                  <MessageBubble
                    message={message}
                    isStreaming={
                      status === 'streaming' &&
                      message === messages[messages.length - 1]
                    }
                    onSendMessage={onSendMessage}
                  />
                )}
              </MessageScrollerItem>
            ))}

            {status === 'submitted' && (
              <MessageScrollerItem>
                {compact ? <CompactThinkingIndicator /> : <ThinkingIndicator />}
              </MessageScrollerItem>
            )}

            {error && status === 'error' && (
              <MessageScrollerItem>
                <StreamErrorBanner message={error.message} onRetry={onRetry} />
              </MessageScrollerItem>
            )}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {composerLayoutVersion !== undefined ? (
          <PinToBottomOnLayoutChange version={composerLayoutVersion} />
        ) : null}
        <MessageScrollerButton />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/**
 * Re-pins the transcript to the live edge when the mobile composer resizes.
 * MessageScroller's autoScroll follows streamed output, but a composer height
 * change is not a content change — so we nudge it back to the end explicitly,
 * matching the old ConversationFollowLayout behaviour.
 */
function PinToBottomOnLayoutChange({ version }: { version: number }) {
  const { scrollToEnd } = useMessageScroller();
  // `version` is intentionally a dependency: bumping it is the signal to
  // re-pin to the bottom on a layout change.
  // biome-ignore lint/correctness/useExhaustiveDependencies: version is the intended re-scroll trigger
  useEffect(() => {
    scrollToEnd();
  }, [version, scrollToEnd]);
  return null;
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

  return (
    <Message align={isUser ? 'end' : 'start'}>
      <MessageContent
        className={cn(
          message.role === 'assistant' && 'min-w-0 max-w-[95%]',
          message.role === 'assistant' && 'gap-3'
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

        {/* Text + rich tool parts in original order. */}
        {message.parts.map((part, i) => {
          if (part.type === 'text') {
            if (isUser) {
              return (
                <Bubble
                  key={`${message.id}-text-${i}`}
                  variant="secondary"
                  align="end"
                >
                  <BubbleContent className="whitespace-pre-wrap">
                    {part.text}
                  </BubbleContent>
                </Bubble>
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
        })}

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
              {sourceParts.map((src, i) => {
                // The AI controls `src.url` — only pass it as an href when it
                // is an explicit http(s) URL; otherwise render as plain text.
                const safeUrl =
                  typeof src.url === 'string' && /^https?:/i.test(src.url)
                    ? src.url
                    : undefined;
                return (
                  <Source
                    key={`${message.id}-src-${i}`}
                    href={safeUrl}
                    title={src.title ?? src.url}
                  />
                );
              })}
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
    <Message align="start">
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
