import { QRCode } from '@/components/kibo-ui/qr-code';

import { SlideShell } from '../components/index';
import type { OnboardingSession, OnboardingSlide } from '../types';

export interface MobileAppSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/** OS-detecting store redirect (see plan — resolves to the right app store). */
const GET_APP_URL = 'https://app.borradh.io/get-app';

/**
 * Slide 15 — `mobile_app`. QR to the OS-detecting store redirect. The
 * +10-credit reward is DEFERRED (owner decision) — mentioned as coming soon,
 * no grant call here.
 */
export function MobileAppSlide({
  session: _session,
  onAdvance,
}: MobileAppSlideProps) {
  return (
    <SlideShell
      step={15}
      headline="Download the **mobile app**."
      description="Leads, messages and your content calendar in your pocket — I'll notify you the moment a lead comes in."
      onSubmit={() => onAdvance('whatsapp')}
      skip={{ label: 'Maybe later', onSkip: () => onAdvance('whatsapp') }}
    >
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
        <QRCode data={GET_APP_URL} className="size-44 rounded-md border p-2" />
        <div className="space-y-2">
          <p className="text-sm">
            Scan with your phone's camera — it takes you straight to the right
            app store.
          </p>
          <p className="text-muted-foreground text-xs">
            A +10 credit reward for installing the app is coming soon.
          </p>
        </div>
      </div>
    </SlideShell>
  );
}
