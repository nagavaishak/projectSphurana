import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Representative CRUD-dispatch fixture (story-family companion to
 * tool-dispatch-create-service).
 *
 * Manage-leads skill: "mark Aoife as contacted" dispatches `updateLead`.
 * `updateLead` is destructive in the factory (it mutates a lead row), so the
 * first call lands a confirmation_required for the `update_lead` action. This
 * fixture stands in for the update side of the wrapper-only CRUD family.
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-update-lead',
  description:
    'Manage-leads skill: "mark Aoife as contacted" dispatches updateLead, which lands a confirmation_required for update_lead.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-leads'] },
  turns: [
    {
      userMessage: 'Mark Aoife Murphy (lead-1) as contacted.',
      expect: {
        toolsCalled: ['updateLead'],
        confirmationPresented: 'update_lead',
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'updateLead',
    destructive: true,
    destructiveAction: 'update_lead',
    summarizeForConfirmation: (input) => ({
      title: 'Update lead',
      fields: [
        { label: 'Lead', value: 'Aoife Murphy' },
        { label: 'Status', value: String(input.status ?? 'contacted') },
      ],
      resourceId: String(input.id ?? input.leadId ?? 'lead-1'),
    }),
    respond: (input) => ({
      ok: true,
      data: {
        id: String(input.id ?? input.leadId ?? 'lead-1'),
        firstName: 'Aoife',
        lastName: 'Murphy',
        status: String(input.status ?? 'contacted'),
      },
    }),
  },
];

export default fixture;
