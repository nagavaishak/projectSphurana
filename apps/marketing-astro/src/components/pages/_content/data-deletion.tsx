'use client';

import { Container } from '@/components/marketing/container';
import { Heading } from '@/components/marketing/heading';
import { Subheading } from '@/components/marketing/subheading';
import { motion } from 'motion/react';

const fadeInUp = {
  initial: { y: 20, opacity: 0, filter: 'blur(6px)' },
  whileInView: { y: 0, opacity: 1, filter: 'blur(0px)' },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.5, ease: 'easeOut' as const },
};

export default function DataDeletionPage() {
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
          <Heading className="text-center mb-4">User Data Deletion</Heading>
          <Subheading className="text-center">
            How to request deletion of your data from Borradh.
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
              How to Request Data Deletion
            </Heading>
            <div className="space-y-4 text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed">
              <p>
                You can request deletion of your personal data at any time by
                sending an email to{' '}
                <a
                  href="mailto:privacy@borradh.io"
                  className="text-neutral-900 dark:text-neutral-100 underline hover:no-underline"
                >
                  privacy@borradh.io
                </a>{' '}
                with the subject line &quot;Data Deletion Request&quot;.
              </p>
              <p>Please include the following in your request:</p>
              <ul className="list-disc list-inside space-y-2">
                <li>Your full name</li>
                <li>The email address associated with your Borradh account</li>
                <li>Your organisation or clinic name (if applicable)</li>
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
              What Data is Deleted
            </Heading>
            <div className="space-y-4 text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed">
              <p>
                Upon a verified deletion request, we will permanently remove the
                following data:
              </p>
              <ul className="list-disc list-inside space-y-2">
                <li>Your account information (name, email, phone number)</li>
                <li>Your organisation and clinic details</li>
                <li>Lead and customer data stored on your behalf</li>
                <li>Content and media you have created or uploaded</li>
                <li>Ad campaign data and performance metrics</li>
                <li>Sequence configurations and automation settings</li>
                <li>
                  Meta integration tokens and connected account information
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
              Facebook &amp; Instagram Users
            </Heading>
            <div className="space-y-4 text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed">
              <p>
                If you logged into Borradh using your Facebook or Instagram
                account, or connected your Meta account to use our advertising
                features, you can also request data deletion through Meta
                directly:
              </p>
              <ol className="list-decimal list-inside space-y-2">
                <li>
                  Go to your{' '}
                  <a
                    href="https://www.facebook.com/settings?tab=applications"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-neutral-900 dark:text-neutral-100 underline hover:no-underline"
                  >
                    Facebook App Settings
                  </a>
                </li>
                <li>Find &quot;Borradh&quot; in your list of apps</li>
                <li>
                  Click &quot;Remove&quot; to revoke access and request data
                  deletion
                </li>
              </ol>
              <p>
                When you remove the app through Meta, we will receive a
                notification and process the deletion of all data associated
                with your Meta account.
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
              Deletion Timeline
            </Heading>
            <div className="space-y-4 text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed">
              <p>
                We will acknowledge your deletion request within{' '}
                <strong className="text-neutral-900 dark:text-neutral-100">
                  48 hours
                </strong>{' '}
                and complete the deletion within{' '}
                <strong className="text-neutral-900 dark:text-neutral-100">
                  30 days
                </strong>
                .
              </p>
              <p>
                Some data may be retained for up to 90 days in encrypted backups
                before being permanently removed. We may also retain limited
                data where required by law or for legitimate business purposes
                (e.g., billing records for tax compliance).
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
              Questions?
            </Heading>
            <div className="text-neutral-600 dark:text-neutral-400 text-base md:text-lg leading-relaxed space-y-4">
              <p>
                If you have any questions about data deletion, please contact
                us:
              </p>
              <ul className="list-none space-y-2">
                <li>
                  Email:{' '}
                  <a
                    href="mailto:privacy@borradh.io"
                    className="text-neutral-900 dark:text-neutral-100 underline hover:no-underline"
                  >
                    privacy@borradh.io
                  </a>
                </li>
                <li>
                  Address: Dogpatch Labs, CHQ Building, Dublin City, Ireland
                </li>
              </ul>
            </div>
          </motion.div>
        </Container>
      </section>
    </div>
  );
}
