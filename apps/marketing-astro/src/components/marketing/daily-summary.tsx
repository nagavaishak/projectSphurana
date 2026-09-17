import { BellRing, MoonStar, ThumbsUp } from 'lucide-react';
import { FeatureSplit } from './feature-split';
import { PhoneMockup } from './phone-mockup';

/**
 * Section 4 — "Your day with Claire".
 * End-of-day summary: Claire reports in (grey, left), the owner approves with a
 * tap (blue, right). Same iMessage skin as the hero — both are Claire talking to
 * the owner, so they should read as the same thread.
 *
 * Copy sits left here, mirroring MidnightLead above it.
 */
export const DailySummary = () => {
  return (
    <FeatureSplit
      mediaSide="right"
      className="bg-[#F8FAFC] dark:bg-neutral-900"
      heading="Claire doesn't wait for you to log in. She tells you what happened."
      lead="One message at the end of the day."
      body="No dashboard to check, no reports to run. Claire sends you what changed, flags what needs a decision, and gets on with it the moment you reply."
      points={[
        { icon: BellRing, label: 'A plain-English summary every evening' },
        { icon: ThumbsUp, label: 'Decisions you approve in one reply' },
        { icon: MoonStar, label: 'She keeps working after you close the app' },
      ]}
      media={
        <PhoneMockup
          variant="imessage"
          contactName="Claire"
          threadDate="Today 6:30 PM"
          messages={[
            { from: 'them', text: "Here's your day 📊" },
            {
              from: 'them',
              delayMs: 900,
              text: [
                'Today:',
                '• 3 new patients booked',
                '• €150 in deposits collected',
                '• Ad spend: €42',
                '• Cost per booking: €14',
                '• 2 reviews requested — 1 already left a 5-star ⭐',
              ],
            },
            {
              from: 'them',
              text: "Tomorrow looks quiet — I'm pushing a flash offer to 34 patients who haven't visited in 6 weeks. I'll let you know how it goes.",
            },
            {
              from: 'them',
              text: 'Also, your top performer this week is laser hair removal. Want me to increase budget on that campaign?',
            },
            // A beat to read the question before the owner answers.
            { from: 'me', text: 'Yes, go for it', delayMs: 2400 },
            {
              from: 'them',
              text: "Done ✓ Budget increased by 30%. I'll check performance in a week.",
            },
          ]}
        />
      }
    />
  );
};
