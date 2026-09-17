import { motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';

import { ClaireAvatar } from '@/components/ui/claire-avatar';

import { CLAIRE_GUIDE_LAYOUT_ID, SlideHeadline } from '../components/index';
import type { OnboardingSession, OnboardingSlide } from '../types';

export interface IntroSlideProps {
  session: OnboardingSession;
  onAdvance: (next: OnboardingSlide, answer?: unknown) => void;
}

const isMacPlatform = () =>
  typeof navigator !== 'undefined' &&
  /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

/**
 * Slide 1 — `intro`. The hero moment: Claire's pulsing avatar animates in,
 * she introduces herself and what she does, then a single Continue moves on
 * to the email-verification step. This is the first thing a brand-new (still
 * unverified) user sees; the very next slide (`verify_email`) is the gate, so
 * everything from the website capture onward runs verified.
 */
export function IntroSlide({ onAdvance }: IntroSlideProps) {
  const isMac = useMemo(isMacPlatform, []);
  const [headlineDone, setHeadlineDone] = useState(false);
  const advance = () => onAdvance('verify_email');

  // Cmd/Ctrl+Enter continues, matching the form slides' SlideShell.
  // onAdvance is a stable useCallback in the container.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      onAdvance('verify_email');
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onAdvance]);

  return (
    <div className="bg-background relative flex min-h-svh w-full flex-col items-center justify-center px-6 py-20">
      <div className="flex w-full max-w-xl flex-col items-center text-center">
        {/* Avatar fades in, then MORPHS into the step badge on the next slide
            (shared layoutId) — Claire stays with you as the guide. */}
        <motion.div
          layoutId={CLAIRE_GUIDE_LAYOUT_ID}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
        >
          <ClaireAvatar
            mood="excited"
            size="lg"
            noBg
            className="text-foreground"
          />
        </motion.div>

        {/* Headline types out as Claire "speaks", then the description follows */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.45, ease: [0.32, 0.72, 0, 1] }}
          className="mt-10"
        >
          <SlideHeadline
            text="Hey there — I'm **Claire**, your AI marketer."
            className="text-3xl sm:text-4xl"
            startDelay={550}
            onDone={() => setHeadlineDone(true)}
          />
          <motion.p
            className="text-muted-foreground mx-auto mt-4 max-w-md text-base"
            initial={{ opacity: 0 }}
            animate={{ opacity: headlineDone ? 1 : 0 }}
            transition={{ duration: 0.4 }}
          >
            I run your marketing end to end — I learn your brand, create your
            content, launch your ads, and reply to every lead the moment they
            come in. Let's get you set up.
          </motion.p>
        </motion.div>

        {/* Continue appears last */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.85, ease: [0.32, 0.72, 0, 1] }}
          className="mt-10 flex flex-col items-center gap-3"
        >
          <button
            type="button"
            onClick={advance}
            className="bg-foreground text-background rounded-md px-8 py-3 text-base font-medium transition-opacity hover:opacity-90"
          >
            Let's go
          </button>
          <span className="text-muted-foreground text-sm">
            press{' '}
            <span className="font-medium">{isMac ? 'Cmd ⌘' : 'Ctrl'}</span> +{' '}
            <span className="font-medium">Enter ↵</span>
          </span>
        </motion.div>
      </div>
    </div>
  );
}
