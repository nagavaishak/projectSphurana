'use client';

import { motion } from 'motion/react';
import { Container } from './container';
import { Heading } from './heading';
import { Reveal } from './reveal';

/**
 * Section 7 — "What happens when Claire runs your clinic."
 * Three before → after stat cards (the "after" in brand blue) and a single
 * testimonial with a blue left border.
 */

const STATS = [
  { before: '47', after: '89', label: 'Leads per month' },
  { before: '€14', after: '€6', label: 'Cost per lead' },
  { before: '12', after: '31', label: 'Bookings per month' },
];

export const Results = () => {
  return (
    <section className="py-16 md:py-24 lg:py-32">
      <Container className="flex flex-col items-center">
        <Reveal>
          <Heading className="text-center mx-auto max-w-3xl">
            What happens when Claire runs your clinic.
          </Heading>
        </Reveal>

        <div className="mt-12 md:mt-16 grid w-full grid-cols-1 gap-4 md:grid-cols-3">
          {STATS.map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              className="rounded-2xl bg-[#F8FAFC] p-8 text-center dark:bg-neutral-900"
            >
              <div className="flex items-center justify-center gap-3">
                <span className="text-3xl font-bold text-neutral-300 dark:text-neutral-600">
                  {stat.before}
                </span>
                <span className="text-2xl text-neutral-300 dark:text-neutral-600">
                  →
                </span>
                <span className="text-5xl font-bold text-brand">
                  {stat.after}
                </span>
              </div>
              <p className="mt-4 text-sm font-medium text-neutral-500 dark:text-neutral-400">
                {stat.label}
              </p>
            </motion.div>
          ))}
        </div>

        <Reveal delay={0.1}>
          <blockquote className="mt-12 md:mt-16 mx-auto max-w-3xl border-l-4 border-brand pl-6">
            <p className="text-xl md:text-2xl font-medium leading-relaxed text-neutral-800 dark:text-neutral-100">
              "I just open my diary and there are patients in it. I don't know
              how they got there. Claire just handles everything."
            </p>
            <footer className="mt-4 text-sm text-neutral-500 dark:text-neutral-400">
              — Clinic owner
            </footer>
          </blockquote>
        </Reveal>
      </Container>
    </section>
  );
};
