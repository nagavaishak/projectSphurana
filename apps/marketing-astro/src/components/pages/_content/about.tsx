'use client';

import { Container } from '@/components/marketing/container';
import { Heading } from '@/components/marketing/heading';
import { Subheading } from '@/components/marketing/subheading';
import { Button } from '@/components/marketing/ui/button';
import { motion } from 'motion/react';
import Image from 'next/image';
import Link from 'next/link';

const values = [
  {
    title: 'Results over promises',
    description: "We don't sell hype. We deliver leads and bookings.",
  },
  {
    title: 'Simplicity wins',
    description:
      'No complicated dashboards. No jargon. Just a system that works.',
  },
  {
    title: 'Clinics come first',
    description: 'Every feature we build is because a clinic needed it.',
  },
] as const;

const founders = [
  {
    image: 'https://i.imgur.com/zjv9PHc.png',
    name: 'Senan Ryan',
    role: 'CEO & Co-Founder',
    bio: 'Built and sold a marketing agency helping clinics grow online. Knows the clinic space inside out.',
  },
  {
    image: '/daniel.png',
    name: 'Daniel Cerasi',
    role: 'CTO & Co-Founder',
    bio: '3 years building software. Designed and built Borradh from the ground up.',
  },
] as const;

const fadeInUp = {
  initial: { y: 20, opacity: 0, filter: 'blur(6px)' },
  whileInView: { y: 0, opacity: 1, filter: 'blur(0px)' },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.5, ease: 'easeOut' as const },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <Container className="py-10 md:py-20 lg:py-32">
        <motion.div
          className="text-center max-w-2xl mx-auto"
          initial={fadeInUp.initial}
          whileInView={fadeInUp.whileInView}
          viewport={fadeInUp.viewport}
          transition={fadeInUp.transition}
        >
          <Heading className="text-center mb-4">
            Built by people who know clinics
          </Heading>
          <Subheading className="text-center">
            Borradh was created by founders who've been in your shoes.
          </Subheading>
        </motion.div>
      </Container>

      {/* Our Story */}
      <section className="py-10 md:py-20 lg:py-32 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="max-w-3xl"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="mb-6">
              Why we built Borradh
            </Heading>
            <p className="text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed">
              We saw the same problem over and over. Clinic owners spending
              thousands on agencies that didn't deliver. Leads going cold
              because no one followed up fast enough. Hours wasted on marketing
              instead of treatments. Borradh exists to fix that. One platform
              that handles your content, runs your ads, and follows up with
              every lead instantly. No agency fees. No wasted time. Just
              results.
            </p>
          </motion.div>
        </Container>
      </section>

      {/* Our Vision */}
      <section className="py-10 md:py-20 lg:py-32 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="max-w-3xl"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="mb-6">
              Where we're going
            </Heading>
            <p className="text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed">
              We're building the marketing system every clinic deserves.
              Affordable, automated, and actually works. Starting with clinics
              in Ireland and the UK, expanding across Europe, and beyond. Our
              goal is simple: become the default way clinics fill their
              calendars.
            </p>
          </motion.div>
        </Container>
      </section>

      {/* Founders */}
      <section className="py-10 md:py-20 lg:py-32 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="text-center max-w-2xl mx-auto mb-12 md:mb-16"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="text-center">
              The team
            </Heading>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 lg:gap-10 max-w-4xl mx-auto">
            {founders.map((founder, index) => (
              <motion.div
                key={founder.name}
                className="rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 overflow-hidden"
                initial={{ y: 24, opacity: 0 }}
                whileInView={{ y: 0, opacity: 1 }}
                viewport={{ once: true, margin: '-30px' }}
                transition={{
                  duration: 0.5,
                  ease: 'easeOut' as const,
                  delay: index * 0.1,
                }}
              >
                <div className="relative aspect-[4/5] bg-neutral-200 dark:bg-neutral-700">
                  <Image
                    src={founder.image}
                    alt={founder.name}
                    fill
                    className="object-cover object-top"
                    sizes="(max-width: 768px) 100vw, 50vw"
                  />
                </div>
                <div className="p-6 md:p-8">
                  <h3 className="text-xl md:text-2xl font-bold font-display text-neutral-900 dark:text-neutral-100">
                    {founder.name}
                  </h3>
                  <p className="text-neutral-500 dark:text-neutral-400 text-sm md:text-base font-medium mt-1">
                    {founder.role}
                  </p>
                  <p className="mt-3 text-neutral-600 dark:text-neutral-400 text-sm md:text-base leading-relaxed">
                    {founder.bio}
                  </p>
                </div>
              </motion.div>
            ))}
          </div>
        </Container>
      </section>

      {/* Our Values */}
      <section className="py-10 md:py-20 lg:py-32 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="text-center max-w-2xl mx-auto mb-12 md:mb-16"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="text-center">
              What we believe
            </Heading>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
            {values.map((value, index) => (
              <motion.div
                key={value.title}
                className="rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-6 md:p-8"
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
                  {value.title}
                </h3>
                <p className="text-neutral-600 dark:text-neutral-400 text-sm md:text-base leading-relaxed">
                  {value.description}
                </p>
              </motion.div>
            ))}
          </div>
        </Container>
      </section>

      {/* CTA */}
      <Container className="py-10 md:py-20 lg:py-32 border-t border-neutral-200 dark:border-neutral-800">
        <motion.div
          className="flex flex-col items-center justify-center gap-6 text-center"
          initial={fadeInUp.initial}
          whileInView={fadeInUp.whileInView}
          viewport={fadeInUp.viewport}
          transition={fadeInUp.transition}
        >
          <Heading as="h2" className="text-center">
            Ready to get started?
          </Heading>
          <Button className="shadow-brand" asChild>
            <Link
              href="https://cal.com/senan-ryan-lx3x8d/30min"
              target="_blank"
              rel="noopener noreferrer"
            >
              Book a Demo
            </Link>
          </Button>
        </motion.div>
      </Container>
    </div>
  );
}
