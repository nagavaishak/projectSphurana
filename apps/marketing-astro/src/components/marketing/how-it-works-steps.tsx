'use client';

import { motion } from 'motion/react';
import { Container } from './container';
import { Heading } from './heading';
import { Reveal } from './reveal';

/**
 * Section 8 — "Up and running in 15 minutes." Three plain steps on a light-grey
 * background. No icons — just clear, confident copy.
 */

const STEPS = [
  {
    n: '1',
    title: 'Connect',
    text: 'Tell Claire about your clinic — services, staff, pricing, availability. Takes 15 minutes.',
  },
  {
    n: '2',
    title: 'Claire goes to work',
    text: 'She runs your ads, responds to every lead, books patients in, collects deposits, creates your content, and manages your patients. 24/7.',
  },
  {
    n: '3',
    title: 'You do treatments',
    text: 'You get WhatsApp updates on what Claire did. Patients are in your diary. Money is in your account. That’s it.',
  },
];

export const HowItWorksSteps = () => {
  return (
    <section className="py-16 md:py-24 lg:py-32 bg-[#F8FAFC] dark:bg-neutral-900">
      <Container>
        <Reveal>
          <Heading className="text-center">
            Up and running in 15 minutes.
          </Heading>
        </Reveal>

        <div className="mt-12 md:mt-16 grid grid-cols-1 gap-8 md:grid-cols-3 md:gap-6">
          {STEPS.map((step, i) => (
            <motion.div
              key={step.n}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              className="flex flex-col"
            >
              <span className="flex size-10 items-center justify-center rounded-full bg-brand text-lg font-bold text-brand-foreground">
                {step.n}
              </span>
              <h3 className="mt-5 text-xl md:text-2xl font-bold">
                {step.title}
              </h3>
              <p className="mt-3 text-base text-neutral-600 dark:text-neutral-300 leading-relaxed">
                {step.text}
              </p>
            </motion.div>
          ))}
        </div>
      </Container>
    </section>
  );
};
