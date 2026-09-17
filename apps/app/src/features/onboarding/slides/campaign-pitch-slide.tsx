import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useConverseSlide, useSuggestService } from '../api/index';
import { SlideInput, SlideOptions, SlideShell } from '../components/index';
import type {
  OnboardingSession,
  OnboardingSlide,
  OnboardingSlideResponse,
  SuggestCampaignServiceResponse,
} from '../types';

export interface CampaignPitchSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/** Option values Claire uses to signal "we're agreed — move on". */
const CONFIRM_VALUES = new Set(['ok', 'confirm', 'accept', 'yes']);

/**
 * The answer recorded for this slide — later slides (service_price /
 * intro_offer) read the suggestion back from `session.answers.campaign_pitch`.
 */
export interface CampaignPitchAnswer {
  serviceId: string;
  serviceName: string;
  priceKnown: boolean;
  priceCents?: number;
  reasons: string[];
}

/**
 * Slide 5 — `campaign_pitch` (conversational). On mount asks the backend
 * which service to lead with; the owner either agrees or free-types push-back
 * that round-trips through Claire. Every Claire reply REPLACES the slide
 * content (headline + options + optional input) — never free-form prose.
 */
export function CampaignPitchSlide({ onAdvance }: CampaignPitchSlideProps) {
  const [conversation, setConversation] =
    useState<OnboardingSlideResponse | null>(null);
  const [userText, setUserText] = useState('');

  // Held in LOCAL state, not read from `mutation.data`: mutations fired from
  // a ref-guarded mount effect lose their observer subscription under React
  // StrictMode's simulated remount (MutationObserver.onUnsubscribe removes
  // the observer and nothing re-attaches it), so `mutation.data` never
  // triggers a re-render. The option callbacks still fire — use those.
  const [suggestion, setSuggestion] =
    useState<SuggestCampaignServiceResponse | null>(null);
  const [failed, setFailed] = useState(false);

  const { suggestService } = useSuggestService({
    onSuccess: (data) => {
      setSuggestion(data);
      setFailed(false);
    },
    onError: () => setFailed(true),
  });

  const { converse, isConversing } = useConverseSlide({
    onSuccess: (data) => {
      setConversation(data.response);
      setUserText('');
    },
  });

  // Ask for the suggestion exactly once on mount.
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    suggestService();
  }, [suggestService]);

  const advance = (accepted: SuggestCampaignServiceResponse) => {
    const answer: CampaignPitchAnswer = {
      serviceId: accepted.serviceId,
      serviceName: accepted.serviceName,
      priceKnown: accepted.priceKnown,
      priceCents: accepted.priceCents,
      reasons: accepted.reasons,
    };
    onAdvance(accepted.priceKnown ? 'intro_offer' : 'service_price', answer);
  };

  const sendText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isConversing) return;
    converse({ slide: 'campaign_pitch', userText: trimmed });
  };

  const handleOption = (value: string) => {
    if (isConversing || !suggestion) return;
    if (CONFIRM_VALUES.has(value)) {
      advance(suggestion);
      return;
    }
    // Non-confirm options from a Claire reply continue the conversation.
    const option = conversation?.options.find((o) => o.value === value);
    sendText(option?.label ?? value);
  };

  const handleSubmit = () => {
    if (userText.trim()) {
      sendText(userText);
      return;
    }
    if (suggestion) advance(suggestion);
  };

  // ── Loading / error states around the initial suggestion ────────────────
  if (!suggestion && !failed) {
    return (
      <SlideShell
        step={5}
        headline="Let's get your **first ads** running."
        description="Give me a second — I'm picking the service we should lead with…"
      >
        <Loader2 className="text-muted-foreground size-5 animate-spin" />
      </SlideShell>
    );
  }

  if (!suggestion) {
    return (
      <SlideShell
        step={5}
        headline="I couldn't pick a **service** to lead with."
        description="Give it another go — this usually clears right up."
      >
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            suggestService();
          }}
          className="border-input hover:bg-muted w-fit rounded-md border px-4 py-2 text-sm font-medium transition-colors"
        >
          Try again
        </button>
      </SlideShell>
    );
  }

  // ── Conversation mode: Claire's reply replaces the slide content ────────
  const headline =
    conversation?.headline ??
    `Let's get your first ads running. We've analysed your niche and will start with **${suggestion.serviceName}**.`;
  const description = conversation?.description ?? suggestion.reasons.join(' ');
  const options = conversation?.options?.length
    ? conversation.options
    : [{ label: 'Ok, sounds good', value: 'ok' }];
  // The opening view always offers free typing; in conversation mode we only
  // render an input when Claire asked for one.
  const showInput = conversation ? Boolean(conversation.input) : true;
  const inputVariant = conversation?.input === 'price' ? 'price' : 'text';

  return (
    <SlideShell
      step={5}
      headline={headline}
      description={description}
      onSubmit={handleSubmit}
      submitLabel={isConversing ? 'Thinking…' : 'Continue'}
      submitDisabled={isConversing}
    >
      <div className="flex flex-col gap-6">
        <SlideOptions options={options} onSelect={handleOption} />
        {showInput && (
          <SlideInput
            variant={inputVariant}
            value={userText}
            onChange={setUserText}
            label="Tell Claire what you'd rather do"
            placeholder={
              conversation
                ? 'Type your answer…'
                : 'Or tell me what you would rather advertise…'
            }
          />
        )}
        {isConversing && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            <span>Claire is thinking…</span>
          </div>
        )}
      </div>
    </SlideShell>
  );
}
