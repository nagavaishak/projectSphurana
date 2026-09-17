import { BookDemoButton } from './book-demo-button';
import { Container } from './container';
import { Heading } from './heading';
import { PhoneMockup } from './phone-mockup';
import { Subheading } from './subheading';

export const Hero = () => {
  return (
    <section className="pt-10 md:pt-16 lg:pt-24 pb-16 md:pb-24 relative overflow-hidden">
      {/* The phone is a fixed 300px, so it takes `auto` and the headline gets
          the rest. A 50/50 split would strand ~288px next to the phone and
          force the headline to wrap mid-sentence. */}
      <Container className="grid items-center gap-12 lg:grid-cols-[1fr_auto] lg:gap-10">
        {/* Left: message */}
        {/* Wide enough for "Claire runs your entire clinic." to hold one line,
            so the headline breaks at the full stop rather than inside it. */}
        <div className="max-w-[46rem]">
          <Heading as="h1">
            Claire runs your entire clinic. You do treatments.
          </Heading>

          {/* Body copy stays narrow — 46rem is a headline measure, not a
              readable line length for prose. */}
          <Subheading className="max-w-xl py-6 md:py-8">
            Claire is your AI employee. She finds new patients, books them in,
            collects deposits, follows up, and keeps them coming back. You get a
            WhatsApp message telling you what she did. That's it.
          </Subheading>

          <div className="flex items-center gap-6">
            <BookDemoButton size="lg" className="shadow-brand" />
          </div>

          <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
            Trusted by 50+ clinics across Ireland and the US
          </p>
        </div>

        {/* Right: the product — a message thread from Claire */}
        <div className="lg:justify-self-end">
          <PhoneMockup
            variant="imessage"
            contactName="Claire"
            threadDate="Today 7:12 AM"
            messages={[
              {
                from: 'them',
                text: 'Morning! ☀️ Here’s your update',
                time: '07:12',
              },
              {
                from: 'them',
                text: '10 of your regulars hadn’t been in for 2 months — I sent them a friendly email to book back in 💌',
                time: '07:12',
              },
              {
                from: 'them',
                text: 'Created 20 pieces of content for this week — take a look',
                time: '07:12',
              },
              // The batch lands as its own beat, the way you'd actually send
              // one. Real content Claire made — first is the top of the stack.
              {
                from: 'them',
                delayMs: 900,
                photos: [
                  {
                    src: '/content/claire-content-botox-tips.webp',
                    alt: 'Instagram post Claire created: 5 tips for your best Botox results',
                  },
                  { src: '/content/claire-content-fat-freezing.webp' },
                  { src: '/content/claire-content-fresh-face.webp' },
                ],
              },
              {
                from: 'them',
                text: 'Your new ad campaign got 12 leads overnight — 4 already booked.',
                time: '07:13',
              },
              {
                from: 'them',
                text: '3 appointments in today, and Sarah’s €50 deposit is confirmed ✓',
                time: '07:13',
              },
              {
                from: 'me',
                text: 'Amazing, thanks Claire 🙌',
                time: '07:15',
                read: true,
              },
            ]}
          />
        </div>
      </Container>
    </section>
  );
};
