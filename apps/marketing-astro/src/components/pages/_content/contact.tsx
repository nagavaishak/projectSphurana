'use client';

import { Container } from '@/components/marketing/container';
import { Heading } from '@/components/marketing/heading';
import { Subheading } from '@/components/marketing/subheading';
import { Button } from '@/components/marketing/ui/button';
import { Instagram, Linkedin, Mail, MapPin, Phone } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';

const FORMSPREE_ENDPOINT = 'https://formspree.io/f/senan@borradh.io';

const fadeInUp = {
  initial: { y: 20, opacity: 0, filter: 'blur(6px)' },
  whileInView: { y: 0, opacity: 1, filter: 'blur(0px)' },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.5, ease: 'easeOut' as const },
};

export default function ContactPage() {
  return (
    <div className="min-h-screen">
      <Container className="py-10 md:py-20 lg:py-32">
        <motion.div
          className="text-center max-w-2xl mx-auto mb-12 md:mb-16"
          initial={fadeInUp.initial}
          whileInView={fadeInUp.whileInView}
          viewport={fadeInUp.viewport}
          transition={fadeInUp.transition}
        >
          <Heading className="text-center mb-4">Get in Touch</Heading>
          <Subheading className="text-center">
            Have questions? We'd love to hear from you.
          </Subheading>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 max-w-5xl mx-auto">
          <motion.div
            className="rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-6 md:p-8"
            initial={{ y: 24, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, margin: '-30px' }}
            transition={{ duration: 0.5, ease: 'easeOut' as const, delay: 0.1 }}
          >
            <form
              action={FORMSPREE_ENDPOINT}
              method="POST"
              className="flex flex-col gap-5"
            >
              <div>
                <label
                  htmlFor="name"
                  className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
                >
                  Name <span className="text-neutral-500">*</span>
                </label>
                <input
                  type="text"
                  id="name"
                  name="name"
                  required
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-2.5 text-neutral-900 dark:text-neutral-100 text-sm md:text-base outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
                  placeholder="Your name"
                />
              </div>
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
                >
                  Email <span className="text-neutral-500">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  required
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-2.5 text-neutral-900 dark:text-neutral-100 text-sm md:text-base outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <label
                  htmlFor="clinic"
                  className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
                >
                  Clinic Name
                </label>
                <input
                  type="text"
                  id="clinic"
                  name="clinic"
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-2.5 text-neutral-900 dark:text-neutral-100 text-sm md:text-base outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition"
                  placeholder="Your clinic name"
                />
              </div>
              <div>
                <label
                  htmlFor="message"
                  className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-1.5"
                >
                  Message
                </label>
                <textarea
                  id="message"
                  name="message"
                  rows={4}
                  className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-2.5 text-neutral-900 dark:text-neutral-100 text-sm md:text-base outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition resize-y min-h-[120px]"
                  placeholder="How can we help?"
                />
              </div>
              <Button
                type="submit"
                className="shadow-brand w-full sm:w-auto mt-1"
              >
                Send Message
              </Button>
            </form>
          </motion.div>

          <motion.div
            className="flex flex-col gap-8"
            initial={{ y: 24, opacity: 0 }}
            whileInView={{ y: 0, opacity: 1 }}
            viewport={{ once: true, margin: '-30px' }}
            transition={{ duration: 0.5, ease: 'easeOut' as const, delay: 0.2 }}
          >
            <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-6 md:p-8">
              <h3 className="text-base font-medium text-neutral-400 mb-4">
                Contact Info
              </h3>
              <ul className="list-none flex flex-col gap-3 text-neutral-600 dark:text-neutral-400 text-sm md:text-base">
                <li>
                  <a
                    href="mailto:senan@borradh.io"
                    className="flex items-center gap-2 hover:text-black dark:hover:text-white transition duration-200"
                  >
                    <Mail className="size-4 shrink-0" />
                    senan@borradh.io
                  </a>
                </li>
                <li>
                  <a
                    href="tel:+353877871690"
                    className="flex items-center gap-2 hover:text-black dark:hover:text-white transition duration-200"
                  >
                    <Phone className="size-4 shrink-0" />
                    +353 87 787 1690
                  </a>
                </li>
                <li>
                  <span className="flex items-start gap-2">
                    <MapPin className="size-4 shrink-0 mt-0.5" />
                    Dogpatch Labs, CHQ Building, Dublin City
                  </span>
                </li>
              </ul>
            </div>
            <div className="rounded-2xl bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 p-6 md:p-8">
              <h3 className="text-base font-medium text-neutral-400 mb-4">
                Follow Us
              </h3>
              <div className="flex items-center gap-4">
                <a
                  href="https://www.linkedin.com/in/senan-ryan-188345387"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition duration-200"
                  aria-label="LinkedIn"
                >
                  <Linkedin className="size-8" />
                </a>
                <a
                  href="https://www.instagram.com/borradh.ie/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-neutral-500 hover:text-neutral-700 dark:hover:text-neutral-300 transition duration-200"
                  aria-label="Instagram"
                >
                  <Instagram className="size-8" />
                </a>
              </div>
            </div>
          </motion.div>
        </div>
      </Container>

      <Container className="py-10 md:py-20 lg:py-32 border-t border-neutral-200 dark:border-neutral-800">
        <motion.div
          className="flex flex-col items-center justify-center gap-6 text-center"
          initial={fadeInUp.initial}
          whileInView={fadeInUp.whileInView}
          viewport={fadeInUp.viewport}
          transition={fadeInUp.transition}
        >
          <Heading as="h2" className="text-center">
            Prefer to talk?
          </Heading>
          <Subheading className="text-center max-w-xl">
            Book a call and we'll walk you through everything.
          </Subheading>
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
