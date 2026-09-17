'use client';

import { motion } from 'motion/react';
import { FeatureSplit } from './feature-split';

/**
 * Section 5 — "One AI employee. Everything connected."
 *
 * Claire at the centre, her responsibilities on a ring around her, dashed
 * spokes connecting them.
 *
 * The nodes are labels only. The paragraph beside the diagram already lists
 * what each one does, so repeating it inside every card just made the diagram
 * something to read rather than something to grasp.
 *
 * Positions are derived from the ring angle rather than hand-placed: the box is
 * square and the maths is shared with the ring, so the nodes sit exactly on it
 * and stay put if the list changes length.
 */

/** Clockwise from the top. Order is deliberate — the two widest labels sit at
 *  12 and 6 o'clock, where a card is centred and has the room. The left and
 *  right extremes get the shortest, since those are the tightest positions. */
const NODES = [
  'Booking & payments',
  'Content & social',
  'Follow-up',
  'Bulk email',
  'Operations & admin',
  'Win-back',
  'Inventory',
  'Advertising',
];

/** Ring radius, in the SVG's 0–100 user space. */
const RADIUS = 40;
/** Where the spokes meet the centre card — just outside its corner. */
const HUB_GAP = 11;

const point = (index: number, radius: number) => {
  // -90° so index 0 lands at the top rather than at 3 o'clock.
  const angle = (-90 + (360 / NODES.length) * index) * (Math.PI / 180);
  return { x: 50 + radius * Math.cos(angle), y: 50 + radius * Math.sin(angle) };
};

const NodeCard = ({ label }: { label: string }) => (
  <div className="whitespace-nowrap rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-medium text-neutral-700 shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
    {label}
  </div>
);

const ClaireNode = () => (
  <div className="rounded-2xl border border-neutral-200 bg-white px-6 py-3.5 text-center shadow-[0_1px_2px_rgba(8,21,46,0.04),0_12px_32px_-12px_rgba(8,21,46,0.18)] dark:border-neutral-800 dark:bg-neutral-950">
    <p className="text-base font-semibold leading-none text-neutral-900 dark:text-neutral-100">
      Claire
    </p>
    <p className="mt-1 text-[10px] uppercase leading-none tracking-wide text-neutral-400">
      Your AI employee
    </p>
  </div>
);

const HubDiagram = () => (
  <div className="w-full">
    {/* Radial (large screens). Square, so the ring is a circle and not an
        ellipse — the percentages only line up in a square box. */}
    <div className="relative mx-auto hidden aspect-square w-full max-w-[600px] lg:block">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        fill="none"
        aria-hidden="true"
      >
        <title>Connections</title>
        <circle
          cx="50"
          cy="50"
          r={RADIUS}
          className="stroke-neutral-200 dark:stroke-neutral-800"
          strokeWidth="0.2"
        />
        {NODES.map((label, i) => {
          const outer = point(i, RADIUS);
          const inner = point(i, HUB_GAP);
          return (
            <g key={label}>
              <line
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                className="stroke-neutral-300 dark:stroke-neutral-700"
                strokeWidth="0.25"
                strokeDasharray="1 1.4"
              />
              {/* The little collar where a spoke leaves the hub. */}
              <circle
                cx={inner.x}
                cy={inner.y}
                r="0.7"
                className="fill-white stroke-neutral-300 dark:fill-neutral-950 dark:stroke-neutral-700"
                strokeWidth="0.25"
              />
            </g>
          );
        })}
      </svg>

      {NODES.map((label, i) => {
        const { x, y } = point(i, RADIUS);
        return (
          <motion.div
            key={label}
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true, margin: '-60px' }}
            transition={{ duration: 0.4, delay: 0.15 + i * 0.08 }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <NodeCard label={label} />
          </motion.div>
        );
      })}

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.4 }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      >
        <ClaireNode />
      </motion.div>
    </div>

    {/* Stacked (mobile / tablet), where a ring has nowhere to go. */}
    <div className="flex w-full flex-col items-center lg:hidden">
      <ClaireNode />
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {NODES.map((label) => (
          <NodeCard key={label} label={label} />
        ))}
      </div>
    </div>
  </div>
);

export const ClaireHub = () => {
  return (
    <FeatureSplit
      mediaSide="left"
      // The diagram needs the room; the copy does not.
      columns="lg:grid-cols-[1.3fr_1fr]"
      heading="One AI employee. Everything connected."
      body="Claire doesn't just do one thing. She runs your entire operation — ads, booking, payments, follow-up, content, bulk email, winning back lapsed customers, inventory, customer management and admin — all connected through one system, all automatically."
      media={<HubDiagram />}
    />
  );
};
