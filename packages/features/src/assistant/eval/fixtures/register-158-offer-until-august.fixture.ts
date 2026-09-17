import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Phase 3 (Time Correctness) — audit register #158: an offer was created
 * pre-expired by 11 months because the model resolved "until August 7th"
 * against its 2025 training prior. Now the model passes the phrase verbatim and
 * the server resolves it to the NEXT future occurrence in the org timezone
 * (2026-08-07); the created offer echoes the absolute end date, and Claire
 * states the future window.
 *
 * No customer data — synthetic offer.
 */
const fixture: ClaireFixture = {
  id: 'register-158-offer-until-august',
  description:
    'Manage-offers skill: "an offer valid until August 7th" passes the phrase to createOffer; the server resolves it to a FUTURE 2026-08-07 window and the created offer echoes it. Claire states the resolved absolute end date, never a past one.',
  category: 'tool-dispatch',
  setup: {
    initialLoadedSkillIds: ['manage-offers'],
    orgContextOverrides: { timezone: 'Europe/Dublin' },
  },
  turns: [
    {
      userMessage:
        'Set up a 20% intro offer on Hydrafacials, valid until August 7th.',
      expect: {
        toolsCalled: ['createOffer'],
        responseContains: ['2026-08-07'],
        claimsRequireToolSupport: [
          { phrase: '2026-08-07', support: '2026-08-07' },
        ],
        responseLacks: ['2025'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'createOffer',
    respond: () => ({
      ok: true,
      data: {
        id: 'off-1',
        name: 'Hydrafacial intro',
        state: 'active',
        discountType: 'percentage',
        discountPercent: 20,
        originalPriceCents: null,
        offerPriceCents: null,
        validFrom: '2026-07-29T00:00:00.000Z',
        // Resolved from "until August 7th" → the next FUTURE occurrence,
        // end of that day, in Europe/Dublin.
        validUntil: '2026-08-07T22:59:00.000Z',
      },
    }),
  },
];

export default fixture;
