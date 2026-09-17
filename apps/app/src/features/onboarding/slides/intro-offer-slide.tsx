import { Loader2 } from 'lucide-react';
import { useState } from 'react';

import { getCurrencySymbol } from '@/features/meta-campaigns/components/create-campaign-form/create-campaign-form.utils';

import {
  useAcceptOffer,
  useConverseSlide,
  useOfferPreview,
} from '../api/index';
import { SlideInput, SlideOptions, SlideShell } from '../components/index';
import type {
  OnboardingSession,
  OnboardingSlide,
  OnboardingSlideResponse,
} from '../types';
import type { CampaignPitchAnswer } from './campaign-pitch-slide';
import {
  type ServicePriceAnswer,
  currencyForOnboardingSession,
  parsePriceToCents,
} from './service-price-slide';

export interface IntroOfferSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/** Option values Claire uses to signal "we're agreed — lock it in". */
const CONFIRM_VALUES = new Set(['ok', 'confirm', 'accept', 'yes']);

const formatCents = (cents: number, currency: string): string =>
  new Intl.NumberFormat('en', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

/**
 * Slide 7 — `intro_offer` (conversational). Accepting creates the REAL offer
 * row server-side and fire-and-forgets ad + video candidate generation, so
 * the copy tells the owner ads are already being created in the background.
 *
 * Price threading: the session PATCH lifts the typed base price from the
 * `service_price` answer into the `servicePriceCents` COLUMN, which the
 * accept endpoint feeds into suggestIntroOffer as the base price — so a
 * plain accept sends NO price and the server computes the discounted intro
 * offer. `offerPriceCents` is only sent when the owner explicitly
 * negotiated a different offer price in the conversation.
 */
export function IntroOfferSlide({ session, onAdvance }: IntroOfferSlideProps) {
  const [conversation, setConversation] =
    useState<OnboardingSlideResponse | null>(null);
  const [userText, setUserText] = useState('');
  /** Price the owner negotiated via the conversation, in cents. */
  const [adjustedPriceCents, setAdjustedPriceCents] = useState<number | null>(
    null
  );

  const pitch = session.answers?.campaign_pitch as
    | CampaignPitchAnswer
    | undefined;
  const servicePrice = session.answers?.service_price as
    | ServicePriceAnswer
    | undefined;

  const serviceName = pitch?.serviceName ?? 'your service';
  const currency = currencyForOnboardingSession(session);

  // The actual intro price the accept endpoint would create (read-only
  // preview of `suggestIntroOffer`) — so the headline says the real number
  // instead of vague "below your base price" copy.
  const { preview } = useOfferPreview();
  // Base price for the "instead of X" framing: the server-derived regular
  // price, else the price typed on the service_price slide, else the one
  // parsed on the pitch slide.
  const basePriceCents =
    preview?.originalPriceCents ??
    servicePrice?.servicePriceCents ??
    pitch?.priceCents;

  const { acceptOffer, isAccepting } = useAcceptOffer({
    onSuccess: () => onAdvance('ad_picker'),
  });

  const { converse, isConversing } = useConverseSlide({
    onSuccess: (data) => {
      setConversation(data.response);
      setUserText('');
    },
  });

  const busy = isAccepting || isConversing;

  const accept = (offerPriceCents?: number) => {
    if (isAccepting) return;
    // Only a NEGOTIATED offer price is sent — the typed BASE price reaches
    // the server via the session column, and sending it here would make the
    // "intro offer" equal the regular price.
    const price = offerPriceCents ?? adjustedPriceCents ?? undefined;
    acceptOffer(price != null ? { offerPriceCents: price } : {});
  };

  const sendText = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    converse({ slide: 'intro_offer', userText: trimmed });
  };

  const handleOption = (value: string) => {
    if (busy) return;
    if (!conversation) {
      if (value === 'ok') {
        accept();
      } else {
        // "No, I want to change it" → open the conversation with Claire.
        sendText('No, I want to change the intro offer price');
      }
      return;
    }
    if (CONFIRM_VALUES.has(value)) {
      accept();
      return;
    }
    const option = conversation.options.find((o) => o.value === value);
    sendText(option?.label ?? value);
  };

  const handleSubmit = () => {
    if (busy) return;
    if (conversation?.input === 'price') {
      // Claire asked for a number — that's the adjusted intro price; lock it
      // in directly (conversation ends in accept).
      const cents = parsePriceToCents(userText);
      if (cents == null) return;
      setAdjustedPriceCents(cents);
      accept(cents);
      return;
    }
    if (userText.trim()) {
      sendText(userText);
      return;
    }
    accept();
  };

  // The intro price to present: owner-negotiated wins, else the server's
  // curated suggestion. NEVER the base price — that would present the regular
  // price as the "offer".
  const offerPriceCents = adjustedPriceCents ?? preview?.offerPriceCents;
  const offerPriceText =
    offerPriceCents != null ? formatCents(offerPriceCents, currency) : null;
  const basePriceText =
    basePriceCents != null && basePriceCents !== offerPriceCents
      ? formatCents(basePriceCents, currency)
      : null;

  const headline =
    conversation?.headline ??
    (offerPriceText
      ? `We'll run an **intro offer** — ${serviceName} for **${offerPriceText}**${basePriceText ? ` instead of ${basePriceText}` : ''} — gets people in the door.`
      : `We'll run an **intro offer** on ${serviceName}, below your base price — gets people in the door.`);
  const description =
    conversation?.description ??
    `New clients get a special first-visit price on ${serviceName}. The moment you say go, I'll start creating your ads in the background.`;

  const options = conversation?.options?.length
    ? conversation.options
    : [
        { label: "OK let's do it", value: 'ok' },
        { label: 'No, I want to change it', value: 'change' },
      ];
  const showInput = Boolean(conversation?.input);
  const inputVariant = conversation?.input === 'price' ? 'price' : 'text';

  return (
    <SlideShell
      step={7}
      headline={headline}
      description={description}
      onSubmit={handleSubmit}
      submitLabel={
        isAccepting ? 'Locking it in…' : isConversing ? 'Thinking…' : 'Continue'
      }
      submitDisabled={
        busy || (conversation?.input === 'price' && !userText.trim())
      }
    >
      <div className="flex flex-col gap-6">
        <SlideOptions options={options} onSelect={handleOption} />
        {showInput && (
          <SlideInput
            variant={inputVariant}
            value={userText}
            onChange={setUserText}
            label="Your answer"
            placeholder={
              inputVariant === 'price' ? '0.00' : 'Type your answer…'
            }
            currencySymbol={
              inputVariant === 'price' ? getCurrencySymbol(currency) : undefined
            }
          />
        )}
        {busy && (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            <span>
              {isAccepting
                ? 'Creating your offer and kicking off your ads…'
                : 'Claire is thinking…'}
            </span>
          </div>
        )}
      </div>
    </SlideShell>
  );
}
