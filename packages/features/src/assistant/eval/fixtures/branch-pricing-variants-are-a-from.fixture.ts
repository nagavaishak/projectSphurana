import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * HELD OUT — a variant-priced service is a "from", not a price.
 *
 * `hasVariants: true` means `priceCents` is the cheapest option, not what the
 * customer will pay. Relaying it flat ("Dermal Filler is €250") understates
 * every other option and is the same customer-facing wrongness as quoting the
 * wrong branch.
 *
 * Worth pinning HERE specifically because variant prices are the one part of
 * the catalogue the branch override does NOT reach —
 * `organization_service_variant` has no per-branch column (§12.5). So the
 * "from" wording is doing double duty: it is honest about the range, and it
 * avoids stating a variant price as if it were branch-specific when it is not.
 */
const fixture: ClaireFixture = {
  id: 'branch-pricing-variants-are-a-from',
  description:
    'A service carrying priced variants is quoted as a "from" price, never as a flat figure.',
  category: 'branch-pricing',
  setup: { initialLoadedSkillIds: ['manage-services'] },
  turns: [
    {
      userMessage: 'How much is Dermal Filler?',
      expect: {
        toolsCalled: ['listServices'],
        // The range has to be signalled. Without this the fixture passes on a
        // flat "it's €250", which is the failure it exists to catch.
        // `responseContains` is a plain substring search, so this pins the one
        // word the "from" wording always carries rather than a pattern.
        responseContains: ['250', 'from'],
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
            id: 'svc-filler',
            name: 'Dermal Filler',
            category: 'treatment',
            description: null,
            isActive: true,
            priceType: 'from',
            priceCents: 25000,
            priceText: null,
            hasVariants: true,
          },
        ],
        total: 1,
      },
    }),
  },
];

export default fixture;
