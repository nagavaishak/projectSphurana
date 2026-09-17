import { Facebook, Instagram, MessageCircle } from 'lucide-react';

import { Checkbox } from '@/components/ui/checkbox';
import { ChatbotTestChat } from '@/features/chatbots/components/chatbot-test-chat';
import {
  useGetInstagramIntegration,
  useListMetaAdsPages,
  useListWhatsAppAccounts,
} from '@/features/integrations/api';

import { SlideShell } from '../components/index';
import type { OnboardingSession, OnboardingSlide } from '../types';

export interface TestChatSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

function ChannelRow({
  icon,
  label,
  active,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
      <Checkbox
        checked={active}
        disabled
        aria-label={`${label} ${active ? 'active' : 'not active'}`}
        className="pointer-events-none"
      />
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-sm">{label}</span>
      <span className="text-muted-foreground ml-auto text-xs">
        {active ? "I'm answering here" : 'Not connected'}
      </span>
    </div>
  );
}

/**
 * Slide 13 — `test_chat`. The owner talks to their own chatbot in the same
 * test harness the dashboard uses, plus a READ-ONLY list of the channels the
 * bot is live on (per what's connected + enabled — enablement is never
 * changed here).
 */
export function TestChatSlide({
  session: _session,
  onAdvance,
}: TestChatSlideProps) {
  const { pages } = useListMetaAdsPages();
  const { integration: igIntegration } = useGetInstagramIntegration();
  const { accounts: whatsappAccounts } = useListWhatsAppAccounts();

  // Real Meta pages only (not ig-standalone virtual pages).
  const metaPages = pages.filter((p) => !p.id.startsWith('ig-standalone:'));

  const messengerActive = metaPages.some(
    (p) => p.platform === 'facebook' && p.isChatbotActive
  );
  const instagramActive =
    (!!igIntegration?.isActive && !!igIntegration.chatbotEnabled) ||
    metaPages.some((p) => p.platform === 'instagram' && p.isChatbotActive);
  const whatsappActive = whatsappAccounts.some((a) => a.isChatbotActive);

  return (
    <SlideShell
      step={13}
      headline="I'll follow up with your leads — **test me** here."
      description="Say hi like a customer would. This is exactly how I'll reply when your leads message you."
      onSubmit={() => onAdvance('content_approval')}
    >
      <div className="space-y-4">
        <div className="h-[420px] overflow-hidden rounded-lg border">
          <ChatbotTestChat />
        </div>

        <div className="space-y-2">
          <p className="text-muted-foreground text-sm">
            Where I'm answering right now:
          </p>
          <ChannelRow
            icon={<Facebook className="size-4" />}
            label="Facebook Messenger"
            active={messengerActive}
          />
          <ChannelRow
            icon={<Instagram className="size-4" />}
            label="Instagram"
            active={instagramActive}
          />
          <ChannelRow
            icon={<MessageCircle className="size-4" />}
            label="WhatsApp"
            active={whatsappActive}
          />
        </div>
      </div>
    </SlideShell>
  );
}
