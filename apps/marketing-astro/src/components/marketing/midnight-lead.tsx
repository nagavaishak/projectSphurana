import { CalendarCheck, MessageCircleReply, UserSearch } from 'lucide-react';
import { FeatureSplit } from './feature-split';
import { PhoneMockup } from './phone-mockup';

/**
 * Section 3 — "A lead DMs you at midnight. Claire responds in 4 seconds."
 * Instagram DM thread: the lead's messages come in (grey, left), Claire
 * answers on the clinic's behalf (blue, right).
 *
 * Leads with the visual, so it alternates against the hero's copy-left layout.
 */
export const MidnightLead = () => {
  return (
    <FeatureSplit
      mediaSide="left"
      heading="A lead DMs you at midnight. Claire responds in 4 seconds."
      lead="You find out at breakfast."
      body="The clinic owner didn't lift a finger. Didn't see the DM. Didn't write a message. Claire found the lead, qualified them, handled the objection, booked them in, and collected a deposit. The owner woke up to money in their account and a new patient in their diary."
      points={[
        { icon: UserSearch, label: 'Found and qualified the lead' },
        { icon: MessageCircleReply, label: 'Handled the objection on price' },
        { icon: CalendarCheck, label: 'Booked them in and took the deposit' },
      ]}
      media={
        <PhoneMockup
          variant="instagram"
          contactName="laser_lead_23"
          contactSubtitle="Active now"
          messages={[
            {
              from: 'them',
              text: 'Hi, how much is laser hair removal?',
              time: '00:02',
            },
            {
              from: 'me',
              text: 'Hey! 👋 It starts from €99, depending on the area. What area are you after?',
              time: '00:02',
            },
            { from: 'them', text: 'Full legs', time: '00:03' },
            {
              from: 'me',
              text: '€149 a session. We’ve Thursday 11am or Friday 3pm — which suits?',
              time: '00:03',
            },
            { from: 'them', text: 'Thursday works', time: '00:04' },
            {
              from: 'me',
              text: 'Perfect, booked you in for Thursday 11am! Just a €50 deposit to confirm 💫',
              link: 'Pay €50 deposit',
              time: '00:04',
            },
            { from: 'them', text: 'Done ✓', time: '00:06' },
            {
              from: 'me',
              text: 'You’re all booked. See you Thursday! 😊',
              time: '00:06',
            },
          ]}
        />
      }
    />
  );
};
