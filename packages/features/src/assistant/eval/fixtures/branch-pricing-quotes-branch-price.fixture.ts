import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * HELD OUT — the headline risk of the location redesign (§3.3, risk 1).
 *
 * Once a service can be priced per branch, `listServices` returns the BRANCH's
 * price for the branch in scope. Claire must relay that number. Quoting the
 * org's base price instead is a wrong price said to a real customer, and it is
 * invisible from the outside: the response shape is identical either way and
 * every plumbing assertion (tool called, confirmation presented) stays green.
 *
 * `responseLacks` carries the actual weight here. `responseContains: ['220']`
 * alone would pass on "it's €250, or €220 at some branches" — the exact hedge
 * that reads as helpful and is still wrong.
 *
 * NOT Botox, deliberately. This fixture originally asked "How much is Botox?"
 * and could never pass: Claire holds a hard line against quoting
 * prescription-only medicine prices in chat ("I don't quote prescription
 * medicine prices directly in chat"), so she never reached `listServices` and
 * never said a number. That guardrail is correct — advertising POMs is
 * regulated — so the fixture moved to a service that carries no such
 * restriction. The branch-pricing behaviour under test is unchanged.
 */
const fixture: ClaireFixture = {
  id: 'branch-pricing-quotes-branch-price',
  description:
    'With Cork in scope, "how much is the Deluxe Facial?" quotes Cork’s overridden €220 and never the org’s €250 base price.',
  category: 'branch-pricing',
  setup: { initialLoadedSkillIds: ['manage-services'] },
  turns: [
    {
      userMessage: 'How much is the Deluxe Facial?',
      expect: {
        toolsCalled: ['listServices'],
        responseContains: ['220'],
        // The org price must not appear at all — not as an alternative, not as
        // a "normally".
        responseLacks: ['250'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listServices',
    destructive: false,
    // What the endpoint returns for a request carrying Cork's X-Location-Id:
    // `priceCents` is already the branch's overridden value (the read path
    // applies `priceCentsOverride` — see applyServiceLocationOverride).
    respond: () => ({
      ok: true,
      data: {
        services: [
          {
            id: 'svc-deluxe-facial',
            name: 'Deluxe Facial',
            category: 'treatment',
            description: null,
            isActive: true,
            priceType: 'fixed',
            priceCents: 22000,
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
