'use client';

import { Container } from '@/components/marketing/container';
import { Heading } from '@/components/marketing/heading';
import { PricingCta } from '@/components/marketing/pricing-cta';
import { Subheading } from '@/components/marketing/subheading';
import { cn } from '@/lib/utils';
import { CircleCheck } from 'lucide-react';
import { motion } from 'motion/react';

const pricingFeatures = [
  'Claire runs your ad campaigns',
  'Instant lead follow-up 24/7',
  'Booking and deposit collection',
  'Content creation from your footage',
  'Patient retention and rebooking',
  'Bulk email and customer management',
  'Admin and day-to-day operations',
  'Full dashboard access',
  'Dedicated Customer Success Manager',
] as const;

const agencyItems = [
  '€2,500+/month',
  'Slow follow-up',
  'Little attention',
  'You do the admin',
  'Limited visibility',
] as const;

const borradhItems = [
  'Instant lead follow-up 24/7',
  'Runs your whole operation',
  'Dedicated Success Manager',
  'Full dashboard access',
] as const;

const fadeInUp = {
  initial: { y: 20, opacity: 0, filter: 'blur(6px)' },
  whileInView: { y: 0, opacity: 1, filter: 'blur(0px)' },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.5, ease: 'easeOut' as const },
};

export default function PricingPage() {
  return (
    <div className="min-h-screen">
      <Container className="py-10 md:py-20 lg:py-32">
        <motion.div
          className="text-center max-w-2xl mx-auto mb-10 md:mb-16"
          initial={fadeInUp.initial}
          whileInView={fadeInUp.whileInView}
          viewport={fadeInUp.viewport}
          transition={fadeInUp.transition}
        >
          <Heading className="text-center mb-4">Simple Pricing</Heading>
          <Subheading className="text-center">
            One plan. Everything Claire does, included. No hidden fees.
          </Subheading>
        </motion.div>

        <motion.div
          className="max-w-lg mx-auto bg-neutral-50 dark:bg-neutral-800 rounded-2xl lg:rounded-3xl overflow-hidden border border-neutral-200 dark:border-neutral-700"
          initial={{ y: 24, opacity: 0, filter: 'blur(8px)' }}
          whileInView={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
          viewport={{ once: true, margin: '-30px' }}
          transition={{ duration: 0.5, ease: 'easeOut' as const, delay: 0.1 }}
        >
          <div className="p-6 md:p-8 lg:p-10 flex flex-col gap-6">
            <p className="text-neutral-600 dark:text-neutral-400 text-base md:text-lg">
              Everything you need to fill your calendar.
            </p>
            <PricingCta className="shadow-brand w-full sm:w-auto" />
            <ul className="list-none flex flex-col gap-3 mt-2">
              {pricingFeatures.map((feature) => (
                <li
                  key={feature}
                  className="flex items-center gap-3 text-neutral-700 dark:text-neutral-300 text-sm md:text-base"
                >
                  <CircleCheck className="size-5 shrink-0 text-neutral-600 dark:text-neutral-400" />
                  <span>{feature}</span>
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      </Container>

      <section className="py-10 md:py-20 lg:py-32 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="text-center max-w-2xl mx-auto mb-12 md:mb-16"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="text-center mb-4">
              Compare to agencies
            </Heading>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 lg:gap-8 max-w-4xl mx-auto">
            <motion.div
              className="rounded-2xl bg-neutral-50 dark:bg-neutral-800/60 border border-neutral-200 dark:border-neutral-700 p-6 md:p-8"
              initial={{ y: 24, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, margin: '-30px' }}
              transition={{
                duration: 0.5,
                ease: 'easeOut' as const,
                delay: 0.1,
              }}
            >
              <h3 className="text-lg md:text-xl font-bold font-display text-neutral-900 dark:text-neutral-100 mb-6">
                Traditional Agency
              </h3>
              <ul className="list-none flex flex-col gap-3">
                {agencyItems.map((item) => (
                  <li
                    key={item}
                    className="flex items-center gap-3 text-neutral-600 dark:text-neutral-400 text-sm md:text-base"
                  >
                    <span className="size-1.5 rounded-full bg-neutral-400 dark:bg-neutral-500 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
            <motion.div
              className={cn(
                'rounded-2xl border-2 p-6 md:p-8',
                'bg-neutral-50 dark:bg-neutral-800',
                'border-primary/30 dark:border-primary/40',
                'ring-2 ring-primary/10 dark:ring-primary/20',
                'shadow-lg shadow-primary/5 dark:shadow-primary/10'
              )}
              initial={{ y: 24, opacity: 0 }}
              whileInView={{ y: 0, opacity: 1 }}
              viewport={{ once: true, margin: '-30px' }}
              transition={{
                duration: 0.5,
                ease: 'easeOut' as const,
                delay: 0.2,
              }}
            >
              <h3 className="text-lg md:text-xl font-bold font-display text-neutral-900 dark:text-neutral-100 mb-6">
                Borradh
              </h3>
              <ul className="list-none flex flex-col gap-3">
                {borradhItems.map((item) => (
                  <li
                    key={item}
                    className="flex items-center gap-3 text-neutral-800 dark:text-neutral-200 text-sm md:text-base font-medium"
                  >
                    <CircleCheck className="size-5 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          </div>
        </Container>
      </section>
    </div>
  );
}
