import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useCallback, useState } from 'react';
import { z } from 'zod';

import {
  type ClairePrefillEntityType,
  isClairePrefillEntityType,
  useAssistantUsage,
} from '@/features/assistant';
import {
  clearAssistantHandoff,
  readAssistantHandoff,
} from '@/features/assistant/lib/pending-handoff';
import {
  ChatContainer,
  ChatSkeleton,
  ConversationList,
  FreeTierGate,
} from './assistant/-components';

const assistantSearchSchema = z
  .object({
    prefill: z.string().optional(),
    entityType: z.string().optional(),
    entityId: z.string().optional(),
    id: z.string().optional(),
    new: z.string().optional(),
    handoff: z.string().optional(),
  })
  .transform((s) => ({
    prefill: s.prefill,
    entityId: s.entityId,
    entityType:
      s.entityType && isClairePrefillEntityType(s.entityType)
        ? s.entityType
        : undefined,
    id: s.id,
    new: s.new,
    handoff: s.handoff,
  }));

export const Route = createFileRoute('/_authed/assistant')({
  validateSearch: assistantSearchSchema,
  component: AssistantPage,
});

function AssistantPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();

  // `?id=xxx` → specific conversation; `?new=1` → new chat; else → list
  const activeConversationId = search.id ?? undefined;
  const isNewChat = search.new === '1';
  const { usage, isLoading: usageLoading } = useAssistantUsage();

  // Hand-off from the home-screen prompt (draft text + picked files), keyed by
  // the `?handoff=` token so the read is idempotent — this page's render phase
  // can run more than once per navigation (chrome swap, lazy chunk, discarded
  // render), and a store that cleared itself on first read used to drop the
  // draft on the floor. Released in `handleConversationCreated`, once the
  // message has actually been sent. Text falls back to the `?prefill=` param.
  // When a hand-off is present the assistant auto-sends on arrival, so the
  // user lands straight in a live conversation (no welcome screen).
  const handoffToken = search.handoff;
  const handoff = readAssistantHandoff(handoffToken);
  const initialFiles = handoff?.files;
  const autoSend = Boolean(handoff);

  const [initialDraft] = useState<string | undefined>(
    () => handoff?.draft ?? search.prefill ?? undefined
  );

  const [initialContext] = useState<
    { entityType: ClairePrefillEntityType; entityId: string } | undefined
  >(() => {
    const rawType = search.entityType;
    const rawId = search.entityId;
    if (!rawType || !rawId) return undefined;
    const trimmedId = rawId.trim();
    if (!trimmedId) return undefined;
    return { entityType: rawType, entityId: trimmedId };
  });

  const handleSelectConversation = useCallback(
    (id: string) => {
      void navigate({ to: '/assistant', search: { id } });
    },
    [navigate]
  );

  // "New Chat" → show the chat surface with no active conversation
  const handleNewChat = useCallback(() => {
    void navigate({ to: '/assistant', search: { new: '1' } });
  }, [navigate]);

  const handleDeleteActive = useCallback(() => {
    void navigate({ to: '/assistant', search: {} });
  }, [navigate]);

  const handleBack = useCallback(() => {
    void navigate({ to: '/assistant', search: {} });
  }, [navigate]);

  const handleConversationCreated = useCallback(
    (id: string) => {
      // The hand-off has served its purpose — the draft is now a real message
      // in a real conversation, so release it before the token leaves the URL.
      clearAssistantHandoff(handoffToken);
      // Update the URL silently without re-mounting the component tree.
      // TanStack's `navigate` with `replace` updates search params in place;
      // `ChatContainer` ignores `conversationId` changes once mounted in
      // "new chat" mode, so the in-flight useChat instance is preserved.
      void navigate({ to: '/assistant', search: { id }, replace: true });
    },
    [navigate, handoffToken]
  );

  const content = (() => {
    if (usageLoading) {
      return <ChatSkeleton />;
    }

    if (usage && !usage.hasAccess) {
      return <FreeTierGate />;
    }

    // Full-page chat when viewing a specific conversation or starting a new one
    if (
      activeConversationId ||
      isNewChat ||
      initialDraft ||
      initialContext ||
      autoSend
    ) {
      return (
        <ChatContainer
          conversationId={activeConversationId}
          onConversationCreated={handleConversationCreated}
          onBack={handleBack}
          initialDraft={initialDraft}
          initialContext={initialContext}
          initialFiles={initialFiles}
          autoSend={autoSend}
        />
      );
    }

    // Full-page conversation list
    return (
      <ConversationList
        activeId={activeConversationId}
        onSelect={handleSelectConversation}
        onNewChat={handleNewChat}
        onDeleteActive={handleDeleteActive}
      />
    );
  })();

  return (
    <>
      <title>Assistant | Borradh</title>
      {content}
    </>
  );
}
