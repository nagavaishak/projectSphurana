'use client';

import { cn } from '@/lib/utils';
import {
  AnimatePresence,
  motion,
  useInView,
  useReducedMotion,
} from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { FeatureSplit } from './feature-split';

/**
 * Section 6 — "Right now, Claire is working for 50+ clinics."
 *
 * The feed is the argument here, so it gets the visual side and the copy just
 * frames it — no bullet list, the feed already reads as one.
 *
 * It runs as a live queue in a fixed viewport rather than a full stack: the
 * claim is that this is happening continuously, so it should never look like a
 * list that ends. Cards arrive at the bottom and leave at the top one at a
 * time, which also stops six cards from setting the height of the section.
 */

const ACTIVITY = [
  {
    action: 'New patient booked',
    detail: 'Sarah M, Laser hair removal, Thursday 2pm. €50 deposit collected.',
    clinic: 'Radiance Clinic',
  },
  {
    action: 'DM responded',
    detail:
      'Instagram enquiry about body contouring. Qualified and booking link sent. 4 second response time.',
    clinic: 'Glow Aesthetics',
  },
  {
    action: 'Ad campaign optimised',
    detail:
      'Cost per lead reduced from €11 to €7.20. Budget reallocated to top performer.',
    clinic: 'Way Better Studios',
  },
  {
    action: 'Content created',
    detail:
      '5 Instagram reels generated from uploaded footage. Queued for approval.',
    clinic: 'Hinoki Aesthetics',
  },
  {
    action: 'Rebooking sent',
    detail:
      '18 patients contacted who haven’t visited in 6+ weeks. 4 rebooked so far.',
    clinic: 'Revival Clinic',
  },
  {
    action: 'Review collected',
    detail:
      '5-star Google review from yesterday’s patient. Auto-requested post-treatment.',
    clinic: 'Bethel Wellness',
  },
];

/** How many cards are on screen at once. */
const VISIBLE = 4;
/** Gap between arrivals. Long enough to read the card that just landed. */
const BEAT_MS = 2600;

const ActivityCard = ({ item }: { item: (typeof ACTIVITY)[number] }) => (
  <div className="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-950">
    <span className="relative mt-1.5 flex size-2.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex size-2.5 rounded-full bg-green-500" />
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {item.action}
      </p>
      <p className="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">
        {item.detail}
      </p>
    </div>
    <span className="shrink-0 whitespace-nowrap text-xs font-medium text-neutral-400">
      {item.clinic}
    </span>
  </div>
);

const ActivityFeed = () => {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  // `once` so the queue keeps its place: re-gating on live visibility would
  // reset the window every time the section scrolled back in.
  const inView = useInView(ref, { once: true, margin: '-64px' });
  const [head, setHead] = useState(0);

  const animates = !prefersReducedMotion;

  useEffect(() => {
    if (!animates || !inView) return;
    const id = setInterval(
      () => setHead((h) => (h + 1) % ACTIVITY.length),
      BEAT_MS
    );
    return () => clearInterval(id);
  }, [animates, inView]);

  // A sliding window over the list. Advancing `head` drops the card at the top
  // and brings the next one in at the bottom, so each beat is one arrival and
  // one departure rather than a continuous crawl.
  const visible = animates
    ? Array.from(
        { length: VISIBLE },
        (_, i) => ACTIVITY[(head + i) % ACTIVITY.length]
      )
    : ACTIVITY;

  return (
    // No fixed height: `popLayout` keeps exactly VISIBLE cards in flow, so the
    // box already sizes to them. Pinning a height would clip the last card on
    // narrow columns, where the detail line wraps and cards grow taller.
    <div
      ref={ref}
      className={cn(
        'relative w-full',
        // Reduced motion: nothing cycles, so the whole list renders — cap it so
        // six cards don't set the height of the section.
        !animates && 'max-h-[440px] overflow-y-auto'
      )}
    >
      {/* `popLayout` pulls a leaving card out of flow immediately, so the ones
          below close the gap while it fades rather than after. */}
      <AnimatePresence initial={false} mode="popLayout">
        {visible.map((item) => (
          <motion.div
            // Keyed on the clinic, not the index — the window is shorter than
            // the list, so these stay unique, and a card keeps its identity as
            // it moves up instead of being recycled in place.
            key={item.clinic}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="mb-3"
          >
            <ActivityCard item={item} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export const LiveActivity = () => {
  return (
    <FeatureSplit
      mediaSide="right"
      className="bg-[#F8FAFC] dark:bg-neutral-900"
      heading="Right now, Claire is working for 50+ clinics."
      lead="A live look at what she's handling."
      body="Every line here is a job a clinic used to do by hand — a DM answered, a deposit taken, a lapsed patient brought back. Claire is doing them across every clinic she runs, right now, without anyone asking."
      media={<ActivityFeed />}
    />
  );
};
