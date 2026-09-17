import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * HELD OUT — the "POA" case.
 *
 * A service with `priceType: 'poa'` carries NO price. The branch override does
 * not invent one either. Claire must say she cannot quote it rather than
 * reaching for a plausible number, because a number stated here is pure
 * fabrication and the customer has no way to tell.
 *
 * This is the shape the production audit called "state asserted, never read
 * back" — `claimsRequireToolSupport` is the assertion that reaches it, since
 * `toolsCalled` passes regardless of what she then says.
 */
const fixture: ClaireFixture = {
  id: 'branch-pricing-no-invented-price',
  description:
    'A price-on-application service is reported as not quotable; Claire states no figure of her own.',
  category: 'branch-pricing',
  setup: { initialLoadedSkillIds: ['manage-services'] },
  turns: [
    {
      userMessage: 'What does the Full Face Rejuvenation cost?',
      expect: {
        toolsCalled: ['listServices'],
        // Enumerated, because that is what this assertion can do
        // deterministically in replay mode: each phrase may only appear if
        // some tool result this turn contains `support`. The tool returned
        // `priceCents: null`, so no figure is supported and any of these in
        // her prose fails the turn.
        claimsRequireToolSupport: [
          { phrase: '€', support: 'priceCents":' },
          { phrase: 'costs', support: 'priceCents":' },
        ],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listServices',
    destructive: false,
    respond: () => ({
      ok: true,
      data: {
        services: [
          {
            id: 'svc-full-face',
            name: 'Full Face Rejuvenation',
            category: 'treatment',
            description: null,
            isActive: true,
            priceType: 'poa',
            priceCents: null,
            priceText: null,
            hasVariants: false,
          },
        ],
        total: 1,
      },
    }),
  },
];

export default fixture;
