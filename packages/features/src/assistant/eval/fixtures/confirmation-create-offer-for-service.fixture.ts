import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'confirmation-create-offer-for-service',
  description:
    'Manage-offers skill: "create an offer for lip filler" routes through recommendOfferForService for a costed proposal, then createOffer surfaces a create_offer confirmation (destructive — never auto-executes).',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['manage-offers'] },
  turns: [
    {
      userMessage: 'Create an offer for my lip filler service.',
      expect: {
        toolsCalled: ['recommendOfferForService', 'createOffer'],
        confirmationPresented: 'create_offer',
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'recommendOfferForService',
    respond: () => ({
      ok: true,
      data: {
        serviceId: 's1',
        serviceName: 'Lip filler',
        suggestedDiscountPct: 15,
        floorPrice: 200,
        rationale:
          'A 15% intro offer stays above cost and is competitive locally.',
      },
    }),
  },
  {
    name: 'createOffer',
    destructive: true,
    destructiveAction: 'create_offer',
    summarizeForConfirmation: (input) => ({
      title: 'Create offer',
      fields: [
        { label: 'Service', value: String(input.service ?? 'Lip filler') },
        { label: 'Discount', value: String(input.discount ?? '15%') },
        { label: 'Validity', value: String(input.validity ?? '2 weeks') },
      ],
      resourceId: String(input.offerId ?? 'offer-1'),
    }),
    respond: () => ({
      ok: true,
      data: {
        offerId: 'offer-1',
        service: 'Lip filler',
        discount: '15%',
        validUntil: '2026-05-09',
        isActive: true,
      },
    }),
  },
];

export default fixture;
