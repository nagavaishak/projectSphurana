import { ChevronDown, ChevronUp } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

import { ClaireAvatar } from '@/components/ui/claire-avatar';
import { cn } from '@/lib/utils';

import { PageGlow } from './page-glow';
import { ShimmerBorder } from './shimmer-border';
import { SlideHeadline } from './slide-headline';

/**
 * Shared layout id so Claire's avatar MORPHS from the intro hero into the
 * step-badge slot (and stays put slide to slide) — she's the guide.
 */
export const CLAIRE_GUIDE_LAYOUT_ID = 'claire-guide';

export interface SlideShellProps {
  /** @deprecated No longer rendered — Claire's avatar is the guide now. */
  step?: number;
  /** Headline copy; `**bold**` spans render as <strong>. */
  headline: string;
  description?: string;
  /** Quiet skip link, top-right. */
  skip?: { label: string; onSkip: () => void };
  onPrev?: () => void;
  onNext?: () => void;
  /** Fires on Continue click and on (Cmd|Ctrl)+Enter. */
  onSubmit?: () => void;
  submitLabel?: string;
  submitDisabled?: boolean;
  /** Animated gradient ring around the viewport (analysis-complete moment). */
  shimmerBorder?: boolean;
  /** Blue edge glow that falls off toward the centre (celebration moment). */
  glow?: boolean;
  children?: ReactNode;
  className?: string;
}

const isMacPlatform = () =>
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/**
 * Typeform-style full-screen slide frame: numbered badge + bold-emphasis
 * headline, muted description, slide body, dark Continue button with a
 * Cmd/Ctrl+Enter hint, quiet skip link top-right and up/down nav chevrons
 * bottom-right.
 */
export function SlideShell({
  headline,
  description,
  skip,
  onPrev,
  onNext,
  onSubmit,
  submitLabel = 'Continue',
  submitDisabled = false,
  shimmerBorder = false,
  glow = false,
  children,
  className,
}: SlideShellProps) {
  const isMac = useMemo(isMacPlatform, []);

  // The description types out only after the headline finishes — Claire says
  // one line, then the next. Reset whenever the headline text changes.
  const [headlineDone, setHeadlineDone] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the headline text changes
  useEffect(() => setHeadlineDone(false), [headline]);

  useEffect(() => {
    if (!onSubmit) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      if (submitDisabled) return;
      event.preventDefault();
      onSubmit();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSubmit, submitDisabled]);

  return (
    <div
      className={cn(
        'bg-background relative flex min-h-svh w-full flex-col',
        className
      )}
    >
      {shimmerBorder && <ShimmerBorder />}
      {glow && <PageGlow />}

      {skip && (
        // Second row, below the layout's "Start over" button, so the two
        // top-right affordances never overlap.
        <div className="absolute top-16 right-6 z-10">
          <button
            type="button"
            onClick={skip.onSkip}
            className="text-muted-foreground hover:text-foreground text-sm underline-offset-4 transition-colors hover:underline"
          >
            {skip.label}
          </button>
        </div>
      )}

      <div className="flex flex-1 items-center justify-center px-6 py-20">
        <div className="w-full max-w-2xl">
          <div className="flex gap-4">
            {/* Claire, the guide — morphs in from the intro hero (shared
                layoutId) and rides along beside every headline. */}
            <motion.div
              layoutId={CLAIRE_GUIDE_LAYOUT_ID}
              className="mt-1 shrink-0"
            >
              <ClaireAvatar
                mood="calm"
                size="xs"
                noBg
                className="text-foreground"
              />
            </motion.div>
            <div className="flex min-w-0 flex-1 flex-col">
              <SlideHeadline
                text={headline}
                onDone={() => setHeadlineDone(true)}
              />
              {description && (
                <motion.p
                  className="text-muted-foreground mt-3 text-base"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: headlineDone ? 1 : 0 }}
                  transition={{ duration: 0.4 }}
                >
                  {description}
                </motion.p>
              )}
              {children && <div className="mt-8">{children}</div>}
              {onSubmit && (
                <div className="mt-10 flex items-center gap-4">
                  <button
                    type="button"
                    onClick={onSubmit}
                    disabled={submitDisabled}
                    className="bg-foreground text-background rounded-md px-6 py-3 text-base font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {submitLabel}
                  </button>
                  <span className="text-muted-foreground text-sm">
                    press{' '}
                    <span className="font-medium">
                      {isMac ? 'Cmd ⌘' : 'Ctrl'}
                    </span>{' '}
                    + <span className="font-medium">Enter ↵</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {(onPrev || onNext) && (
        <div className="border-border divide-border absolute right-6 bottom-6 z-10 flex divide-x overflow-hidden rounded-md border">
          <button
            type="button"
            aria-label="Previous slide"
            disabled={!onPrev}
            onClick={onPrev}
            className="bg-background text-foreground hover:bg-muted flex size-10 items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronUp className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next slide"
            disabled={!onNext}
            onClick={onNext}
            className="bg-background text-foreground hover:bg-muted flex size-10 items-center justify-center transition-colors disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronDown className="size-5" />
          </button>
        </div>
      )}
    </div>
  );
}
