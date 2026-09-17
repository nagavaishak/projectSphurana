import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Structured-pricing create flow (fresha-clone). The operator states a single
 * fixed price; Claire dispatches `createService` with `priceType: 'fixed'` +
 * `priceCents`, landing a `confirmation_required` for create_service. Guards
 * the drift where the skill prompt used to say pricing was "informational only".
 */
const fixture: ClaireFixture = {
  id: 'confirmation-create-service-fixed-price',
  description:
    'Manage-services skill: "add LED Light Therapy, €45, 30 min" dispatches createService with structured fixed pricing and lands a confirmation_required for create_service.',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['manage-services'] },
  turns: [
    {
      userMessage: 'Add a service called LED Light Therapy — €45, 30 minutes.',
      expect: {
        toolsCalled: ['createService'],
        confirmationPresented: 'create_service',
        responseContains: ['45'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'createService',
    destructive: true,
    destructiveAction: 'create_service',
    summarizeForConfirmation: (input) => ({
      title: `Create service "${String(input.name ?? 'LED Light Therapy')}"`,
      fields: [
        {
          label: 'Service name',
          value: String(input.name ?? 'LED Light Therapy'),
        },
        { label: 'Price', value: '€45' },
      ],
      resourceId: `service:${String(input.name ?? 'LED Light Therapy')}`,
    }),
    respond: (input) => ({
      ok: true,
      data: {
        serviceId: 'svc-led-1',
        name: String(input.name ?? 'LED Light Therapy'),
        category: 'treatment',
        isActive: true,
        variantsCreated: 0,
      },
    }),
  },
];

export default fixture;
