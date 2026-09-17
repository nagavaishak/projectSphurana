'use client';

import { Container } from '@/components/marketing/container';
import { Heading } from '@/components/marketing/heading';
import { Subheading } from '@/components/marketing/subheading';
import { motion } from 'motion/react';
import Link from 'next/link';

const fadeInUp = {
  initial: { y: 20, opacity: 0, filter: 'blur(6px)' },
  whileInView: { y: 0, opacity: 1, filter: 'blur(0px)' },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.5, ease: 'easeOut' as const },
};

const subProcessors = [
  {
    name: 'Amazon Web Services (AWS)',
    purpose:
      'Cloud infrastructure, database hosting, file storage, secrets management, SMS delivery (SNS)',
    location: 'Ireland (eu-west-1) / US',
    data: 'All platform data',
  },
  {
    name: 'Meta Platforms',
    purpose:
      'Ad campaigns, lead forms, page management, WhatsApp messaging, chatbot conversations',
    location: 'USA',
    data: 'Lead data, ad creatives, targeting data, messages, conversation content',
  },
  {
    name: 'Stripe',
    purpose: 'Payment processing, subscription billing, deposits',
    location: 'USA',
    data: 'Customer name, email, payment details',
  },
  {
    name: 'Google (Calendar, Gmail, Maps, Drive, My Business)',
    purpose:
      'Calendar integration, email sending, geocoding, template storage, business reviews',
    location: 'USA',
    data: 'Emails, calendar events, addresses, reviews, files',
  },
  {
    name: 'Microsoft (Outlook)',
    purpose: 'Email integration',
    location: 'USA',
    data: 'Email addresses, email content',
  },
  {
    name: 'Telnyx',
    purpose: 'AI voice calls, phone number provisioning',
    location: 'USA',
    data: 'Phone numbers, call transcripts, recordings, AI summaries',
  },
  {
    name: 'ElevenLabs',
    purpose: 'Text-to-speech for voice calls',
    location: 'USA',
    data: 'Voice synthesis data',
  },
  {
    name: 'OpenAI',
    purpose: 'LLM for voice AI agents, website analysis, chatbot intelligence',
    location: 'USA',
    data: 'Lead context, conversation content, website content',
  },
  {
    name: 'Resend',
    purpose: 'Transactional email delivery',
    location: 'USA',
    data: 'Email addresses, email content',
  },
  {
    name: 'Loops.so',
    purpose: 'Email marketing automation',
    location: 'USA',
    data: 'Email addresses, contact properties',
  },
  {
    name: 'Calendly',
    purpose: 'Appointment scheduling',
    location: 'USA',
    data: 'Event details, availability, invitee information',
  },
  {
    name: 'Timely / Phorest',
    purpose: 'Booking system integration',
    location: 'Various',
    data: 'Appointment details, availability',
  },
  {
    name: 'PostHog',
    purpose: 'Product analytics',
    location: 'USA',
    data: 'Usage events, anonymised user identifiers',
  },
  {
    name: 'Sentry',
    purpose: 'Error monitoring',
    location: 'USA',
    data: 'Error logs, user IDs (no personal data beyond ID)',
  },
  {
    name: 'BetterStack (Logtail)',
    purpose: 'Log aggregation and monitoring',
    location: 'USA',
    data: 'Server logs, request metadata',
  },
];

export default function DataProcessingAgreementPage() {
  return (
    <div className="min-h-screen">
      <Container className="py-10 md:py-20 lg:py-32">
        <motion.div
          className="text-center max-w-2xl mx-auto"
          initial={fadeInUp.initial}
          whileInView={fadeInUp.whileInView}
          viewport={fadeInUp.viewport}
          transition={fadeInUp.transition}
        >
          <Heading className="text-center mb-4">
            Data Processing Agreement
          </Heading>
          <Subheading className="text-center">
            Effective: February 2026
          </Subheading>
        </motion.div>
      </Container>

      <section className="py-10 md:py-20 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="max-w-3xl"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="mb-6">
              Introduction &amp; Parties
            </Heading>
            <div className="space-y-4 text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed">
              <p>
                This Data Processing Agreement (&quot;DPA&quot;) forms part of
                the{' '}
                <Link
                  href="/terms"
                  className="text-neutral-900 dark:text-neutral-100 underline hover:no-underline"
                >
                  Terms of Service
                </Link>{' '}
                between:
              </p>
              <ul className="list-none space-y-3">
                <li>
                  <strong className="text-neutral-900 dark:text-neutral-100">
                    Data Controller:
                  </strong>{' '}
                  The Customer (the clinic, business, or individual using the
                  Borradh platform)
                </li>
                <li>
                  <strong className="text-neutral-900 dark:text-neutral-100">
                    Data Processor:
                  </strong>{' '}
                  Borradh Technologies Limited, 72 Mount Prospect Avenue,
                  Clontarf, Dublin 3, D03 XV79, Ireland
                </li>
              </ul>
              <p>
                Contact:{' '}
                <a
                  href="mailto:privacy@borradh.io"
                  className="text-neutral-900 dark:text-neutral-100 underline hover:no-underline"
                >
                  privacy@borradh.io
                </a>
              </p>
              <p>
                This DPA sets out the terms under which the Processor processes
                Personal Data on behalf of the Controller in connection with the
                Services, and reflects the parties&apos; agreement with regard
                to the processing of Personal Data in accordance with the
                requirements of Data Protection Laws.
              </p>
            </div>
          </motion.div>
        </Container>
      </section>

      <section className="py-10 md:py-20 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="max-w-3xl"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="mb-6">
              Sub-processors
            </Heading>
            <div className="space-y-6 text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed">
              <p>
                The Controller provides general written authorisation for the
                Processor to engage the following sub-processors:
              </p>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-sm md:text-base border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-200 dark:border-neutral-700">
                      <th className="text-left py-3 pr-4 font-semibold text-neutral-900 dark:text-neutral-100">
                        Sub-processor
                      </th>
                      <th className="text-left py-3 pr-4 font-semibold text-neutral-900 dark:text-neutral-100">
                        Purpose
                      </th>
                      <th className="text-left py-3 pr-4 font-semibold text-neutral-900 dark:text-neutral-100">
                        Location
                      </th>
                      <th className="text-left py-3 font-semibold text-neutral-900 dark:text-neutral-100">
                        Data Processed
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {subProcessors.map((sp) => (
                      <tr
                        key={sp.name}
                        className="border-b border-neutral-100 dark:border-neutral-800"
                      >
                        <td className="py-3 pr-4 font-medium text-neutral-900 dark:text-neutral-100 whitespace-nowrap">
                          {sp.name}
                        </td>
                        <td className="py-3 pr-4">{sp.purpose}</td>
                        <td className="py-3 pr-4 whitespace-nowrap">
                          {sp.location}
                        </td>
                        <td className="py-3">{sp.data}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p>
                The Processor shall provide the Controller with at least{' '}
                <strong className="text-neutral-900 dark:text-neutral-100">
                  14 days&apos; prior notice
                </strong>{' '}
                of any intended changes to sub-processors. The Controller may
                object within{' '}
                <strong className="text-neutral-900 dark:text-neutral-100">
                  7 days
                </strong>{' '}
                of receiving notice.
              </p>
            </div>
          </motion.div>
        </Container>
      </section>

      <section className="py-10 md:py-20 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="max-w-3xl"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="mb-6">
              Security &amp; Data Transfers
            </Heading>
            <div className="space-y-4 text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed">
              <p>
                Personal Data is stored in AWS eu-west-1 (Ireland) where
                possible. Transfers to US-based sub-processors are covered by EU
                Standard Contractual Clauses (Module 2: Controller to Processor)
                and the UK International Data Transfer Addendum.
              </p>
              <p>
                We implement encryption in transit (TLS/HTTPS) and at rest (AWS
                RDS storage encryption, AWS Secrets Manager), role-based access
                control, Row-Level Security (RLS) at the PostgreSQL database
                level, OAuth-token AES encryption, network isolation in private
                subnets, and structured logging with error tracking.
              </p>
              <p>
                The Processor shall notify the Controller{' '}
                <strong className="text-neutral-900 dark:text-neutral-100">
                  without undue delay
                </strong>{' '}
                (and no later than 48 hours) upon becoming aware of a Personal
                Data Breach.
              </p>
            </div>
          </motion.div>
        </Container>
      </section>

      <section className="py-10 md:py-20 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="max-w-3xl"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="mb-6">
              Data Retention &amp; Deletion
            </Heading>
            <div className="space-y-4 text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed">
              <p>
                Personal Data is processed for the duration of the service
                agreement. On termination, the Controller may request the return
                or deletion of all Personal Data.
              </p>
              <ul className="list-disc list-inside space-y-3">
                <li>
                  Deletion of active data completed within{' '}
                  <strong className="text-neutral-900 dark:text-neutral-100">
                    30 days
                  </strong>{' '}
                  of request
                </li>
                <li>
                  Backup data purged within{' '}
                  <strong className="text-neutral-900 dark:text-neutral-100">
                    90 days
                  </strong>
                </li>
                <li>
                  Limited data may be retained where required by law (e.g.,
                  billing records for tax compliance)
                </li>
              </ul>
            </div>
          </motion.div>
        </Container>
      </section>

      <section className="py-10 md:py-20 border-t border-neutral-200 dark:border-neutral-800">
        <Container>
          <motion.div
            className="max-w-3xl"
            initial={fadeInUp.initial}
            whileInView={fadeInUp.whileInView}
            viewport={fadeInUp.viewport}
            transition={fadeInUp.transition}
          >
            <Heading as="h2" className="mb-6">
              Contact
            </Heading>
            <div className="text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed space-y-4">
              <p>For questions about this DPA, please contact:</p>
              <ul className="list-none space-y-2">
                <li>
                  <strong className="text-neutral-900 dark:text-neutral-100">
                    Borradh Technologies Limited
                  </strong>
                </li>
                <li>
                  72 Mount Prospect Avenue, Clontarf, Dublin 3, D03 XV79,
                  Ireland
                </li>
                <li>
                  Email:{' '}
                  <a
                    href="mailto:privacy@borradh.io"
                    className="text-neutral-900 dark:text-neutral-100 underline hover:no-underline"
                  >
                    privacy@borradh.io
                  </a>
                </li>
              </ul>
              <p>
                See also our{' '}
                <Link
                  href="/privacy"
                  className="text-neutral-900 dark:text-neutral-100 underline hover:no-underline"
                >
                  Privacy Policy
                </Link>{' '}
                and{' '}
                <Link
                  href="/data-deletion"
                  className="text-neutral-900 dark:text-neutral-100 underline hover:no-underline"
                >
                  Data Deletion Policy
                </Link>
                .
              </p>
            </div>
          </motion.div>
        </Container>
      </section>
    </div>
  );
}
