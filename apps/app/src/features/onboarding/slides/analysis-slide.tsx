import type { AnalyzeWebsiteResponse } from '@borradh-workspace/api-client/types';
import { Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import {
  useAnalysisJob,
  useApplyAnalysis,
  useStartWebsiteAnalysis,
} from '../api/index';
import { ShimmerCard, SlideShell } from '../components/index';
import type {
  AnalyzeWebsiteJobStatus,
  OnboardingSession,
  OnboardingSlide,
} from '../types';

export interface AnalysisSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

/** Claire-voice progress copy per analyzer phase. */
const PHASE_COPY: Record<AnalyzeWebsiteJobStatus['phase'], string> = {
  pending: 'Warming up…',
  fetching: 'Reading your website…',
  discovering: 'Exploring your pages…',
  analyzing: 'Extracting your brand, services and locations…',
  done: 'All done.',
  error: 'Something went wrong.',
};

/** Card that pops into view with a staggered spring. */
function RevealCard({
  index,
  title,
  children,
}: {
  index: number;
  title: string;
  children: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.4,
        delay: index * 0.15,
        ease: [0.32, 0.72, 0, 1],
      }}
      className="border-input flex min-h-32 flex-col gap-2 rounded-lg border p-4"
    >
      <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {title}
      </span>
      {children}
    </motion.div>
  );
}

/**
 * Slide 4 — `analysis`. Polls the website-analysis job (2s) and pops result
 * cards into view when it completes: brand colors, logo, services and
 * locations. On done the shell gets the shimmer border and Continue applies
 * the analysis (THE org-creation moment) before advancing.
 *
 * The analyzer only exposes `phase` while running — the result payload
 * arrives whole on `done` — so cards reveal together with a stagger.
 */
export function AnalysisSlide({ session, onAdvance }: AnalysisSlideProps) {
  // A retry mints a fresh jobId before the session refetch lands.
  const [retryJobId, setRetryJobId] = useState<string | null>(null);
  const jobId = retryJobId ?? session.analysisJobId;

  const { job } = useAnalysisJob(jobId);
  const [applyError, setApplyError] = useState<string | null>(null);

  const { applyAnalysis, isApplying } = useApplyAnalysis({
    onSuccess: () => onAdvance('content_source'),
    onError: (error) => setApplyError(error.message),
  });

  const { startAnalysis, isStarting } = useStartWebsiteAnalysis({
    onSuccess: (newJobId) => setRetryJobId(newJobId),
  });

  // Email is already verified by the dedicated `verify_email` slide that
  // precedes this one, and the backend AuthGuard enforces it again on
  // apply-analysis — so Continue (the org-creation moment) is safe to offer
  // as soon as the analysis is done.
  const skippedWebsite = !session.websiteUrl;

  // Resume-safe: prefer the live job result, fall back to the snapshot the
  // backend persisted onto the session.
  const result =
    job?.result ??
    (session.analysisResult as Partial<AnalyzeWebsiteResponse> | null) ??
    null;
  const failed = !skippedWebsite && job?.status === 'error';
  const done = skippedWebsite || Boolean(result);
  const running = !done && !failed;

  const handleContinue = () => {
    if (isApplying) return;
    setApplyError(null);
    applyAnalysis();
  };

  const headline = skippedWebsite
    ? "**No website** — we'll start from scratch."
    : failed
      ? "I couldn't finish **analysing your website**."
      : done
        ? 'Your analysis is **complete**.'
        : '**Analysing your brand** and creating your personalised marketing plan…';

  const description = skippedWebsite
    ? "That's ok — I'll build your brand as we go."
    : failed
      ? (job?.error ?? 'The analysis hit a snag — give it another try.')
      : done
        ? "Here's what I found. Look right? I'll set everything up from this."
        : PHASE_COPY[job?.phase ?? 'pending'];

  const services = result?.services ?? [];
  const locations = result?.locations ?? [];

  return (
    <SlideShell
      step={3}
      headline={headline}
      description={description}
      glow={done && !skippedWebsite}
      onSubmit={done ? handleContinue : undefined}
      submitLabel={isApplying ? 'Setting up…' : 'Continue'}
      submitDisabled={isApplying}
    >
      {running && (
        <div className="flex flex-col gap-4">
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            <span>{PHASE_COPY[job?.phase ?? 'pending']}</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <ShimmerCard label="Brand colors" />
            <ShimmerCard label="Logo" />
            <ShimmerCard label="Services" />
            <ShimmerCard label="Locations" />
          </div>
        </div>
      )}

      {failed && (
        <button
          type="button"
          disabled={isStarting}
          onClick={() =>
            session.websiteUrl &&
            startAnalysis({ websiteUrl: session.websiteUrl })
          }
          className="border-input hover:bg-muted rounded-md border px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
        >
          {isStarting ? 'Retrying…' : 'Retry analysis'}
        </button>
      )}

      {done && !skippedWebsite && result && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {(result.primaryColor || result.secondaryColor) && (
            <RevealCard index={0} title="Brand colors">
              <div className="flex items-center gap-3">
                {[result.primaryColor, result.secondaryColor]
                  .filter((c): c is string => Boolean(c))
                  .map((color) => (
                    <div key={color} className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="border-input size-8 rounded-full border"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-muted-foreground text-sm">
                        {color}
                      </span>
                    </div>
                  ))}
              </div>
            </RevealCard>
          )}

          {result.logoUrl && (
            <RevealCard index={1} title="Logo">
              <img
                src={result.logoUrl}
                alt="Your logo"
                className="max-h-16 w-fit max-w-full object-contain"
              />
            </RevealCard>
          )}

          {services.length > 0 && (
            <RevealCard index={2} title="Services">
              <ul className="flex flex-col gap-1 text-sm">
                {services.slice(0, 5).map((service) => (
                  <li key={service.name}>{service.name}</li>
                ))}
                {services.length > 5 && (
                  <li className="text-muted-foreground">
                    +{services.length - 5} more
                  </li>
                )}
              </ul>
            </RevealCard>
          )}

          {locations.length > 0 && (
            <RevealCard index={3} title="Locations">
              <ul className="flex flex-col gap-1 text-sm">
                {locations.slice(0, 3).map((location) => (
                  <li key={`${location.addressLine1}-${location.city}`}>
                    {[location.addressLine1, location.city]
                      .filter(Boolean)
                      .join(', ')}
                  </li>
                ))}
                {locations.length > 3 && (
                  <li className="text-muted-foreground">
                    +{locations.length - 3} more
                  </li>
                )}
              </ul>
            </RevealCard>
          )}
        </div>
      )}

      {applyError && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {skippedWebsite
            ? 'I need at least a website to name your business — go back and add one.'
            : applyError}
          {skippedWebsite && (
            <button
              type="button"
              onClick={() => onAdvance('website')}
              className="ml-2 font-medium underline underline-offset-4"
            >
              Add a website
            </button>
          )}
        </p>
      )}
    </SlideShell>
  );
}
