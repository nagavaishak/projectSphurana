import { Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

import { useStageCampaign } from '../api/index';
import { SlideShell } from '../components/index';
import type {
  OnboardingSession,
  OnboardingSlide,
  OnboardingStagedCampaign,
} from '../types';

export interface CampaignReviewSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

const formatDailyBudget = (cents: number, currency?: string): string =>
  new Intl.NumberFormat('en', {
    style: 'currency',
    currency: currency || 'EUR',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);

const NURTURE_LABELS: Record<string, string> = {
  messenger: 'Facebook Messenger',
  whatsapp: 'WhatsApp',
};

/** The default lead-form questions (mirrors labels' defaultLeadFormQuestions). */
const LEAD_FORM_TIMING = {
  label: 'How soon are you hoping to get this treatment done?',
  options: ['ASAP', '1 week', '2 weeks'],
};

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

/** A disabled, form-look field mimicking the Meta instant form. */
function FakeFormField({ label }: { label: string }) {
  return (
    <div className="space-y-1">
      <span className="text-muted-foreground text-xs font-medium">{label}</span>
      <div className="border-border h-8 rounded-md border bg-background" />
    </div>
  );
}

/**
 * Slide 10 — `campaign_review`. Stages the campaign server-side on mount
 * (idempotent — re-staging reuses the draft lead form), then shows the
 * campaign config next to a preview of the lead form leads will fill in.
 */
export function CampaignReviewSlide({
  session,
  onAdvance,
}: CampaignReviewSlideProps) {
  // Held in LOCAL state, not read from `mutation.data`: mutations fired from
  // a ref-guarded mount effect lose their observer subscription under React
  // StrictMode's simulated remount, so `mutation.data` never re-renders. The
  // option callbacks still fire — use those.
  const [stagedCampaign, setStagedCampaign] =
    useState<OnboardingStagedCampaign | null>(null);
  const [failed, setFailed] = useState(false);

  const { stageCampaign } = useStageCampaign({
    onSuccess: (staged) => {
      setStagedCampaign(staged);
      setFailed(false);
    },
    onError: () => setFailed(true),
  });

  // Stage once on mount. Idempotent server-side, but avoid double-firing
  // from strict-mode re-renders.
  const stagedRef = useRef(false);
  useEffect(() => {
    if (stagedRef.current) return;
    stagedRef.current = true;
    stageCampaign({});
  }, [stageCampaign]);

  // Prefer the fresh mutation result; fall back to the persisted session copy
  // (resume case) while the re-stage round-trips.
  const staged = stagedCampaign ?? session.stagedCampaign;
  const isStaging = !staged && !failed;

  const targetingParts: string[] = [];
  if (staged?.targeting?.location)
    targetingParts.push(staged.targeting.location);
  if (staged?.targeting?.distanceKm)
    targetingParts.push(`${staged.targeting.distanceKm} km radius`);

  return (
    <SlideShell
      step={10}
      headline="We'll bring leads to a **form** and I'll **message them** when they come in. Ok?"
      description="Here's the campaign I've set up — nothing goes live until you connect Meta on the next step."
      onSubmit={() => onAdvance('meta_connect')}
      submitDisabled={!staged || isStaging}
    >
      {isStaging ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" />
          Putting your campaign together…
        </div>
      ) : !staged && failed ? (
        <div className="space-y-3">
          <p className="text-destructive text-sm">
            I couldn't stage the campaign. Give it another go.
          </p>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setFailed(false);
              stageCampaign({});
            }}
          >
            Try again
          </Button>
        </div>
      ) : staged ? (
        <div className="grid gap-4 md:grid-cols-2">
          {/* LEFT — campaign config */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Your campaign</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ConfigRow label="Name" value={staged.name} />
              <ConfigRow
                label="Daily budget"
                value={`${formatDailyBudget(
                  staged.dailyBudgetCents,
                  staged.currency
                )} / day`}
              />
              {targetingParts.length > 0 && (
                <ConfigRow
                  label="Targeting"
                  value={targetingParts.join(' · ')}
                />
              )}
              {staged.nurtureChannel && (
                <ConfigRow
                  label="I'll follow up on"
                  value={
                    NURTURE_LABELS[staged.nurtureChannel] ??
                    staged.nurtureChannel
                  }
                />
              )}
            </CardContent>
          </Card>

          {/* RIGHT — lead form preview */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                The form leads will fill in
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <FakeFormField label="Full name" />
              <FakeFormField label="Email" />
              <FakeFormField label="Phone number" />
              <div className="space-y-1.5">
                <span className="text-muted-foreground text-xs font-medium">
                  {LEAD_FORM_TIMING.label}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {LEAD_FORM_TIMING.options.map((option) => (
                    <span
                      key={option}
                      className="border-border text-muted-foreground rounded-full border px-2.5 py-1 text-xs"
                    >
                      {option}
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </SlideShell>
  );
}
