import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import { AskAiMobileComposer } from '@/features/assistant/_components/ask-ai-mobile-composer';
import { useCallback, useState } from 'react';

interface ConversationMobileComposerProps {
  onSend: (content: string) => void;
  disabled?: boolean;
  isSending?: boolean;
  placeholder?: string;
  onLayoutChange?: () => void;
}

/**
 * Mobile inbox composer — same glass pill UI/behavior as the Ask AI sheet.
 */
export function ConversationMobileComposer({
  onSend,
  disabled = false,
  isSending = false,
  placeholder = 'Message',
  onLayoutChange,
}: ConversationMobileComposerProps) {
  const [draft, setDraft] = useState('');

  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text?.trim();
      if (!text || disabled || isSending) {
        return;
      }
      onSend(text);
      setDraft('');
    },
    [disabled, isSending, onSend]
  );

  return (
    <div className="sticky bottom-0 z-20 shrink-0 overflow-visible bg-transparent px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1.5">
      <AskAiMobileComposer
        draft={draft}
        onDraftChange={setDraft}
        onSubmit={handleSubmit}
        onStop={() => undefined}
        status="ready"
        placeholder={placeholder}
        disabled={disabled || isSending}
        submitDisabled={!draft.trim() || disabled || isSending}
        onAttachClick={() => undefined}
        onLayoutChange={onLayoutChange}
        compactPadding
      />
    </div>
  );
}
