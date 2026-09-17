import { Loader2, MessageSquare } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateChatbotSettings } from '@/features/chatbots/api';
import {
  DIRECTIVE_LABEL,
  type VoiceScript,
  useUpdateVoiceScript,
} from '@/features/voice-scripts';

import { ChatbotTestChat } from './chatbot-test-chat';

/**
 * The label comes from the voice-script declaration, not from a literal here —
 * the form contract locates the control by the same string. The card writes the
 * script field through its OWN control (the chatbot's vocabulary), so the string
 * lives beside the form rather than in `form.labels`.
 */
const L = { script: DIRECTIVE_LABEL };

/** Opens the chatbot test chat in a dialog so it doesn't compete with the
 * directive editor for vertical space. */
function TestChatDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <MessageSquare className="mr-1.5 size-3" />
          Test chatbot
        </Button>
      </DialogTrigger>
      <DialogContent className="flex h-[80vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Test chatbot</DialogTitle>
          <DialogDescription>
            Chat with your AI assistant using the current saved directive.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          <ChatbotTestChat />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export interface DirectiveCardProps {
  organizationId: string;
  chatbotSystemPrompt: string | null;
  voiceScript: VoiceScript | null;
}

/**
 * The main "directive" (system prompt). Drives the customer chatbot and, when a
 * voice script already exists, keeps the AI voice caller's agent script in sync
 * so a single instruction governs both channels.
 *
 * The voice-script write goes through the shared `useUpdateVoiceScript` hook +
 * `buildUpdateVoiceScriptPayload` so its body cannot drift from the other two
 * voice-script surfaces (onboarding editor, voice panel).
 */
export function DirectiveCard({
  organizationId,
  chatbotSystemPrompt,
  voiceScript,
}: DirectiveCardProps) {
  const [directive, setDirective] = useState(chatbotSystemPrompt ?? '');

  const { updateChatbotSettings, isUpdating } = useUpdateChatbotSettings();
  const { updateVoiceScript, isUpdating: isUpdatingVoice } =
    useUpdateVoiceScript();

  useEffect(() => {
    setDirective(chatbotSystemPrompt ?? '');
  }, [chatbotSystemPrompt]);

  const hasChanges = directive !== (chatbotSystemPrompt ?? '');
  const isSaving = isUpdating || isUpdatingVoice;

  const handleSave = () => {
    const trimmed = directive.trim();
    updateChatbotSettings({
      organizationId,
      chatbotSystemPrompt: trimmed || null,
    });
    // Keep the voice caller's agent script aligned with the chatbot directive.
    if (voiceScript) {
      updateVoiceScript({ id: voiceScript.id, script: trimmed || null });
    }
  };

  return (
    // No Card wrapper: the Textarea already draws a bordered surface, so a Card
    // around it rendered a box inside a box. And no `flex-1` — it used to
    // stretch to the full viewport height, which made a short instruction look
    // like an empty page. It sizes to a sensible default and the user can drag
    // it taller.
    <div className="flex flex-col gap-2">
      <Label htmlFor="directive">{L.script}</Label>
      <div className="relative flex flex-col">
        <Textarea
          id="directive"
          className="min-h-[140px] resize-y pb-14 text-sm"
          onChange={(e) => setDirective(e.target.value)}
          placeholder="e.g. You are a helpful assistant for our clinic. Help customers book appointments, answer FAQs, and qualify leads. Be warm, concise, and professional..."
          value={directive}
        />
        <div className="absolute right-3 bottom-3 flex items-center gap-2">
          <TestChatDialog />
          <Button
            disabled={isSaving || !hasChanges}
            onClick={handleSave}
            size="sm"
          >
            {isSaving && <Loader2 className="mr-1.5 size-3 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
