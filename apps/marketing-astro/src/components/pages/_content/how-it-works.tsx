'use client';

import { Container } from '@/components/marketing/container';
import { Heading } from '@/components/marketing/heading';
import { Subheading } from '@/components/marketing/subheading';
import { cn } from '@/lib/utils';
import { Globe } from 'lucide-react';
import { motion } from 'motion/react';

const steps = [
  {
    number: 1,
    title: 'Connect your clinic',
    description:
      'Add your website and connect your tools. Claire onboards onto the Borradh operating system and learns your services, staff, pricing and availability. It takes minutes.',
  },
  {
    number: 2,
    title: 'Claire takes over',
    description:
      'Claire runs your business — ads, lead follow-up, bookings, deposits, content, bulk email, winning back lapsed customers, inventory and admin. 24/7, all automatically.',
  },
  {
    number: 3,
    title: 'Watch the results come in',
    description:
      'New patients book into your calendar, deposits land in your account, and old customers come back. You get WhatsApp updates and a full dashboard whenever you want it.',
  },
] as const;

const integrations = [
  { name: 'Facebook', icon: '/facebook-icon.svg' },
  { name: 'Instagram', icon: '/instagram-icon.svg' },
  { name: 'Google', icon: null },
  { name: 'Gmail', icon: '/gmail-icon.svg' },
  { name: 'WhatsApp', icon: '/whatsapp-icon.svg' },
] as const;

const clinicPoints = [
  {
    title: 'No agency fees',
    description: 'Stop paying €3,000+/month for inconsistent results.',
  },
  {
    title: 'No manual work',
    description: 'No posting, no chasing leads, no admin, no spreadsheets.',
  },
  {
    title: 'No learning curve',
    description: 'Connect your clinic once — Claire handles the rest.',
  },
] as const;

const fadeInUp = {
  initial: { y: 20, opacity: 0, filter: 'blur(6px)' },
  whileInView: { y: 0, opacity: 1, filter: 'blur(0px)' },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.5, ease: 'easeOut' as const },
};

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen">
      <Container className="py-10 md:py-20 lg:py-32">
        <motion.div
          className="flex xl:flex-row flex-col xl:items-end justify-between gap-10"
          initial={fadeInUp.initial}
          whileInView={fadeInUp.whileInView}
          viewport={fadeInUp.viewport}
          transition={fadeInUp.transition}
        >
          <Heading className="text-center lg:text-left">
            How Claire Works
          </Heading>
          <Subheading className="text-center lg:text-left mx-auto lg:mx-0 max-w-2xl">
            Three simple steps to a full calendar. Trusted by clinics across
            Ireland, the UK, and the US.
          </Subheading>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 my-10 md:my-20">
          {steps.map((step, index) => (
            <motion.div
              key={step.number}
              className={cn(
                'max-w-full mx-auto bg-neutral-50 dark:bg-neutral-800 rounded-lg',
                index === 0 && 'rounded-tl-3xl rounded-bl-3xl',
                index === steps.length - 1 && 'rounded-tr-3xl rounded-br-3xl'
              )}
              initial={{ y: 24, opacity: 0, filter: 'blur(8px)' }}
              whileInView={{ y: 0, opacity: 1, filter: 'blur(0px)' }}
              viewport={{ once: true, margin: '-30px' }}
              transition={{
                duration: 0.5,
                ease: 'easeOut' as const,
                delay: index * 0.1,
              }}
            >
              <div className="relative h-80 sm:h-60 md:h-80 overflow-hidden flex items-center justify-center">
                <span className="text-7xl md:text-8xl font-display font-bold text-neutral-200 dark:text-neutral-600">
                  {step.number}
                </span>
              </div>
              <div className="px-4 md:px-8 md:pb-12 pb-6 flex items-center justify-between">
                <h3 className="text-lg md:text-2xl font-bold font-display">
                  {step.title}
                </h3>
              </div>
              <div className="px-4 md:px-8 pb-6 pt-0 text-neutral-500 dark:text-neutral-400 text-sm md:text-base">
                {step.description}
              </div>
            </motion.div>
          ))}
        </div>
      </Container>

      <section className="py-10 md:py-20 lg:py-32 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="text-center max-w-2xl mx-auto mb-10"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="text-center mb-4">
              Connects with your tools
            </Heading>
            <Subheading className="text-center">
              Claire works with Facebook, Instagram, Google, Gmail, and
              WhatsApp.
            </Subheading>
          </motion.div>
          <motion.div
            className="flex flex-wrap justify-center gap-3"
            initial={{ y: 20, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, margin: '-20px' }}
            transition={{ duration: 0.5, delay: 0.15 }}
          >
            {integrations.map((item) => (
              <span
                key={item.name}
                className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800/80 px-4 py-2.5 text-sm font-medium text-neutral-700 dark:text-neutral-300"
              >
                {item.icon ? (
                  <img src={item.icon} alt="" className="size-4" />
                ) : (
                  <Globe className="size-4" />
                )}
                {item.name}
              </span>
            ))}
          </motion.div>
        </Container>
      </section>

      <section className="py-10 md:py-20 lg:py-32 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="text-center max-w-2xl mx-auto mb-14"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="text-center mb-4">
              Why clinics switch to Borradh
            </Heading>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
            {clinicPoints.map((point, index) => (
              <motion.div
                key={point.title}
                className="rounded-2xl bg-neutral-50 dark:bg-neutral-800/80 border border-neutral-200 dark:border-neutral-700 p-6 md:p-8"
                initial={{ y: 24, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true, margin: '-30px' }}
                transition={{
                  duration: 0.5,
                  ease: 'easeOut' as const,
                  delay: index * 0.1,
                }}
              >
                <h3 className="text-lg md:text-xl font-bold font-display text-neutral-900 dark:text-neutral-100 mb-2">
                  {point.title}
                </h3>
                <p className="text-neutral-600 dark:text-neutral-400 text-sm md:text-base">
                  {point.description}
                </p>
              </motion.div>
            ))}
          </div>
        </Container>
      </section>
    </div>
  );
}
