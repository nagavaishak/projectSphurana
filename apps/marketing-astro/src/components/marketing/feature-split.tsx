import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';
import type React from 'react';
import { Container } from './container';
import { Heading } from './heading';
import { Reveal } from './reveal';

/**
 * A story step: the visual on one side, the copy on the other.
 *
 * Alternate `mediaSide` down the page so consecutive steps mirror each other —
 * the hero already runs copy-left/visual-right, so the first step should lead
 * with the visual.
 */

export type FeaturePoint = {
  icon: LucideIcon;
  label: string;
};

export const FeatureSplit = ({
  mediaSide = 'left',
  media,
  heading,
  lead,
  body,
  points,
  columns,
  className,
}: {
  mediaSide?: 'left' | 'right';
  /** Sits directly on the section — no card or panel behind it. */
  media: React.ReactNode;
  heading: React.ReactNode;
  /** Short line directly under the heading. */
  lead?: React.ReactNode;
  /** The paragraph that carries the argument. */
  body?: React.ReactNode;
  /** Scannable summary for readers who skip the paragraph. */
  points?: FeaturePoint[];
  /**
   * Grid template for the split. Defaults to an even 50/50 — widen the media
   * side for visuals that need the room (a diagram, say, rather than a phone).
   */
  columns?: string;
  className?: string;
}) => {
  const mediaFirst = mediaSide === 'left';

  return (
    <section className={cn('py-16 md:py-24 lg:py-32', className)}>
      <Container
        className={cn(
          'grid items-center gap-10 lg:gap-16',
          columns ?? 'lg:grid-cols-2'
        )}
      >
        {/* Visual. Source order puts it first so it leads on mobile, where the
            column collapses — the phone is the hook, the copy explains it. */}
        <Reveal
          className={cn('flex justify-center', !mediaFirst && 'lg:order-2')}
        >
          {media}
        </Reveal>

        <Reveal
          delay={0.1}
          className={cn(
            'max-w-xl',
            !mediaFirst && 'lg:order-1 lg:justify-self-end'
          )}
        >
          {/* A step lower than the hero: 60px is sized for a full-width
              headline and wraps to four lines in a half-width column. */}
          <Heading className="lg:text-5xl">{heading}</Heading>

          {lead ? (
            <p className="mt-4 text-lg text-neutral-500 md:text-xl dark:text-neutral-400">
              {lead}
            </p>
          ) : null}

          {body ? (
            <p className="mt-6 text-base leading-relaxed text-neutral-600 md:text-lg dark:text-neutral-300">
              {body}
            </p>
          ) : null}

          {points?.length ? (
            <ul className="mt-8 md:mt-10">
              {points.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="flex items-center gap-4 border-b border-neutral-200 py-4 last:border-b-0 dark:border-neutral-800"
                >
                  <Icon
                    className="size-5 shrink-0 text-neutral-400 dark:text-neutral-500"
                    aria-hidden
                  />
                  <span className="text-base text-neutral-800 md:text-lg dark:text-neutral-200">
                    {label}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Reveal>
      </Container>
    </section>
  );
};
