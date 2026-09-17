import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Create-service-with-variants flow (fresha-clone). The operator names a
 * service with multiple priced options; Claire dispatches `createService` with
 * a `variants` array, which lands a `confirmation_required` for create_service.
 * The confirmation surfaces the variant labels.
 */
const fixture: ClaireFixture = {
  id: 'confirmation-create-service-variants',
  description:
    'Manage-services skill: "add Dermal Filler with 1/2/3 area options" dispatches createService with variants and lands a confirmation_required for create_service.',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['manage-services'] },
  turns: [
    {
      userMessage:
        'Add a Dermal Filler service with options: 1 area €200, 2 areas €350, 3 areas €480.',
      expect: {
        toolsCalled: ['createService'],
        confirmationPresented: 'create_service',
        responseContains: ['area'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'createService',
    destructive: true,
    destructiveAction: 'create_service',
    summarizeForConfirmation: (input) => {
      const variants = Array.isArray(input.variants)
        ? (input.variants as { name: string }[]).map((v) => v.name).join(', ')
        : '1 area, 2 areas, 3 areas';
      return {
        title: `Create service "${String(input.name ?? 'Dermal Filler')}"`,
        fields: [
          {
            label: 'Service name',
            value: String(input.name ?? 'Dermal Filler'),
          },
          { label: 'Variants', value: variants },
        ],
        resourceId: `service:${String(input.name ?? 'Dermal Filler')}`,
      };
    },
    respond: (input) => ({
      ok: true,
      data: {
        serviceId: 'svc-dermal-1',
        name: String(input.name ?? 'Dermal Filler'),
        category: 'injectables',
        isActive: true,
        variantsCreated: 3,
      },
    }),
  },
];

export default fixture;
