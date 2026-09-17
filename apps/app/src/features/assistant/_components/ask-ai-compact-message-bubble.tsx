import type { UIMessage } from 'ai';
import { useMemo } from 'react';

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
import { AskAiMessageBubble } from './ask-ai-message-bubble';
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

interface CompactMessageBubbleProps {
  message: UIMessage;
  isStreaming: boolean;
  onSendMessage: (text: string) => void;
}

export function CompactMessageBubble({
  message,
  isStreaming,
  onSendMessage,
}: CompactMessageBubbleProps) {
  const isUser = message.role === 'user';

  const {
    textParts,
    toolParts,
    reasoningParts,
    sourceParts,
    fileParts,
    memoryRecallParts,
  } = useMemo(() => bucketParts(message.parts), [message.parts]);

  const userText = textParts
    .map((p) => (p.type === 'text' ? p.text : ''))
    .join('')
    .trim();

  const hasPendingConfirmation = toolParts.some(
    (tp) =>
      CONFIRMATION_TOOLS.has(getToolName(tp)) && tp.state !== 'output-available'
  );

  const hasReasoning = reasoningParts.length > 0;
  const reasoningStreaming =
    isStreaming &&
    hasReasoning &&
    reasoningParts.some((p) => p.state === 'streaming');

  const hasVisibleAssistantContent =
    textParts.length > 0 ||
    toolParts.some((tp) =>
      isToolPartVisible(tp, message.role === 'assistant')
    ) ||
    hasReasoning ||
    sourceParts.length > 0 ||
    fileParts.length > 0 ||
    memoryRecallParts.length > 0;

  const showThinkingPlaceholder =
    !isUser && isStreaming && !hasVisibleAssistantContent;

  if (isUser) {
    return (
      <div className="flex w-full flex-col items-end gap-2">
        {fileParts.length > 0 && (
          <Attachments className="max-w-[88%]" variant="grid">
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
        {userText ? (
          <AskAiMessageBubble variant="user">
            <p className="whitespace-pre-wrap">{userText}</p>
          </AskAiMessageBubble>
        ) : null}
      </div>
    );
  }

  const assistantTextNodes = message.parts.map((part, i) => {
    if (part.type !== 'text' || !part.text.trim()) return null;
    return (
      <MessageResponse
        key={`${message.id}-text-${i}`}
        className="text-[15px] leading-snug text-[#0A0A0A] [&_*]:text-[#0A0A0A]"
      >
        {part.text}
      </MessageResponse>
    );
  });

  const hasAssistantText = assistantTextNodes.some(Boolean);

  return (
    <div className="flex w-full flex-col items-start gap-2">
      {showThinkingPlaceholder && (
        <AskAiMessageBubble variant="assistant">
          <span className="text-[#8E8E93]">Thinking...</span>
        </AskAiMessageBubble>
      )}

      {hasAssistantText && (
        <AskAiMessageBubble variant="assistant">
          {assistantTextNodes}
        </AskAiMessageBubble>
      )}

      {!isUser && hasReasoning && (
        <Reasoning
          isStreaming={reasoningStreaming}
          defaultOpen={hasPendingConfirmation}
          className="w-full max-w-[88%]"
        >
          <ReasoningTrigger />
          <ReasoningContent>{joinReasoning(reasoningParts)}</ReasoningContent>
        </Reasoning>
      )}

      {message.parts.map((part, i) => {
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
          <div key={`${tp.toolCallId}-${i}`} className="w-full max-w-full">
            <ToolRenderer
              toolName={toolName}
              toolPart={tp}
              onSendMessage={onSendMessage}
            />
          </div>
        );
      })}

      {fileParts.length > 0 && (
        <Attachments className="max-w-[88%]" variant="grid">
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

      {memoryRecallParts.length > 0 && (
        <div className="flex max-w-[88%] flex-wrap gap-1.5">
          {memoryRecallParts.map((payload) => (
            <MemoryRecallBadge
              key={payload.knowledgeEntryId}
              payload={payload}
            />
          ))}
        </div>
      )}

      {sourceParts.length > 0 && (
        <Sources className="max-w-[88%]">
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

      {!showThinkingPlaceholder &&
        !hasAssistantText &&
        !hasVisibleAssistantContent && (
          <AskAiMessageBubble variant="assistant">
            <span className="text-[#8E8E93]">Thinking...</span>
          </AskAiMessageBubble>
        )}
    </div>
  );
}

export function CompactThinkingIndicator() {
  return (
    <AskAiMessageBubble variant="assistant">
      <span className="text-[#8E8E93]">Thinking...</span>
    </AskAiMessageBubble>
  );
}

// ---------------------------------------------------------------------------
// Helpers (mirrored from message-list.tsx)
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

    if (part.type === 'reasoning') {
      reasoningParts.push(part as unknown as ReasoningPartLike);
      continue;
    }

    if (part.type === 'source-url' || part.type === 'source-document') {
      sourceParts.push(part as unknown as SourcePartLike);
      continue;
    }

    const memoryRecall = asMemoryRecallPart(part);
    if (memoryRecall) {
      memoryRecallParts.push(memoryRecall);
      continue;
    }

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
