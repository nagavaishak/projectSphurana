import { MobileBottomSheet } from '@/components/mobile-bottom-sheet';
import { useAssistantUsage } from '@/features/assistant';
import { ChatContainer } from '@/features/assistant/_components/chat-container';
import { ChatSkeleton } from '@/features/assistant/_components/chat-skeleton';
import { FreeTierGate } from '@/features/assistant/_components/free-tier-gate';
import { MobileHeaderIconButton } from '@/features/mobile-dashboard-header';
import { cn } from '@/lib/utils';
import { History, Sparkles, SquarePen } from 'lucide-react';
import { useCallback, useState } from 'react';

import { MobileAskAiHistorySheet } from './mobile-ask-ai-history-sheet';

interface MobileAskAiSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Ask AI — chat UI inside the shared mobile bottom sheet.
 */
export function MobileAskAiSheet({
  open,
  onOpenChange,
}: MobileAskAiSheetProps) {
  const { usage, isLoading: usageLoading } = useAssistantUsage();

  const [conversationId, setConversationId] = useState<string | undefined>(
    undefined
  );
  /** Live id from ChatView — can differ from `conversationId` before parent sync. */
  const [liveConversationId, setLiveConversationId] = useState<
    string | undefined
  >(undefined);
  const [chatKey, setChatKey] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activeChatHasMessages, setActiveChatHasMessages] = useState(false);

  const newChatDisabled = !conversationId && !activeChatHasMessages;
  const showClaireBranding = Boolean(conversationId) || activeChatHasMessages;

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setHistoryOpen(false);
        setActiveChatHasMessages(false);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const handleNewChat = useCallback(() => {
    setConversationId(undefined);
    setLiveConversationId(undefined);
    setChatKey((k) => k + 1);
    setActiveChatHasMessages(false);
  }, []);

  const handleSelectConversation = useCallback((id: string) => {
    setConversationId(id);
    setChatKey((k) => k + 1);
  }, []);

  const handleConversationCreated = useCallback((id: string) => {
    setConversationId(id);
    setLiveConversationId(id);
  }, []);

  const handleActiveConversationIdChange = useCallback(
    (id: string | undefined) => {
      setLiveConversationId(id);
    },
    []
  );

  return (
    <>
      <MobileBottomSheet
        open={open}
        onOpenChange={handleOpenChange}
        title="Ask AI"
        keyboardAware
      >
        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="relative z-[2] flex min-h-[58px] shrink-0 items-center justify-between px-4 pb-3">
            <MobileHeaderIconButton
              aria-label="Chat history"
              onClick={() => setHistoryOpen(true)}
            >
              <History className="size-[15px] text-[#525252]" strokeWidth={2} />
            </MobileHeaderIconButton>

            <div
              className={cn(
                'pointer-events-none flex flex-col items-center gap-0.5 transition-opacity duration-200',
                showClaireBranding ? 'opacity-100' : 'opacity-0'
              )}
              aria-hidden={!showClaireBranding}
            >
              <div className="flex size-13 items-center justify-center rounded-full bg-[#2E65F3] shadow-[0_2px_8px_rgba(46,101,243,0.35)]">
                <Sparkles
                  className="size-[22px] text-white"
                  strokeWidth={2.25}
                />
              </div>
              <span className="text-[13px] font-bold leading-tight tracking-[-0.2px] text-black">
                Claire AI
              </span>
            </div>

            <MobileHeaderIconButton
              aria-label="New chat"
              disabled={newChatDisabled}
              onClick={handleNewChat}
            >
              <SquarePen
                className={
                  newChatDisabled
                    ? 'size-[15px] text-[#C7C7CC]'
                    : 'size-[15px] text-[#525252]'
                }
                strokeWidth={2}
              />
            </MobileHeaderIconButton>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-4">
            {usageLoading ? (
              <ChatSkeleton />
            ) : usage && !usage.hasAccess ? (
              <div className="min-h-0 flex-1 overflow-y-auto bg-white py-3">
                <FreeTierGate />
              </div>
            ) : (
              <ChatContainer
                // Stable key across first-send conversation creation — remounting
                // on id would swap ChatView → ExistingChatView and flash empty UI.
                key={chatKey}
                conversationId={conversationId}
                onConversationCreated={handleConversationCreated}
                onBack={handleNewChat}
                onMessagesChange={(n) => setActiveChatHasMessages(n > 0)}
                onActiveConversationIdChange={handleActiveConversationIdChange}
                sheetPresentation="askAiMobile"
              />
            )}
          </div>
        </div>
      </MobileBottomSheet>

      <MobileAskAiHistorySheet
        open={open && historyOpen}
        onOpenChange={setHistoryOpen}
        activeConversationId={liveConversationId ?? conversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
      />
    </>
  );
}
