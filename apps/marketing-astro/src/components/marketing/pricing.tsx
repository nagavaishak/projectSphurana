import { CircleCheck } from 'lucide-react';
import { BookDemoButton } from './book-demo-button';
import { Container } from './container';
import { Heading } from './heading';
import { Reveal } from './reveal';
import { Subheading } from './subheading';

/**
 * Section 9 — pricing. One AI employee, everything included. Single card with a
 * blue border and a single "Book a Demo" CTA (no price shown).
 */

const INCLUDED = [
  'Claire runs your ad campaigns',
  'Instant lead follow-up 24/7',
  'Booking and deposit collection',
  'Content creation from your footage',
  'Wins back lapsed patients',
  'Bulk email campaigns',
  'Inventory management',
  'Patient and customer management',
  'Admin and day-to-day operations',
  'WhatsApp updates to you daily',
  'Dedicated Customer Success Manager',
];

export const Pricing = () => {
  return (
    <section className="py-16 md:py-24 lg:py-32">
      <Container className="flex flex-col items-center">
        <Reveal className="flex flex-col items-center">
          <Heading className="text-center">
            One AI employee. Everything included.
          </Heading>
          <Subheading className="mt-4 max-w-2xl text-center">
            No hidden fees. No per-feature pricing. One AI that runs your clinic
            — book a demo and we'll walk you through it.
          </Subheading>
        </Reveal>

        <Reveal delay={0.1} className="mt-12 flex justify-center">
          <div className="w-full max-w-md rounded-2xl border-2 border-brand bg-white dark:bg-neutral-950 p-6 md:p-8 shadow-brand">
            <ul className="flex flex-col gap-3">
              {INCLUDED.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <CircleCheck className="mt-0.5 size-5 shrink-0 text-brand" />
                  <span className="text-sm md:text-base text-neutral-700 dark:text-neutral-200">
                    {item}
                  </span>
                </li>
              ))}
            </ul>

            <BookDemoButton size="lg" className="mt-8 w-full" />
          </div>
        </Reveal>
      </Container>
    </section>
  );
};
