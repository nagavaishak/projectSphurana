import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'tool-dispatch-leads',
  description:
    'Manage-leads skill is loaded; the model dispatches `listLeads` for a recency check and weaves the result into prose. Verifies the leads tool surface is reachable from the orchestrator + classifier path.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-leads'] },
  turns: [
    {
      userMessage: 'Show me my leads from this week.',
      expect: {
        toolsCalled: ['listLeads'],
        responseContains: ['lead'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listLeads',
    respond: () => ({
      ok: true,
      data: {
        leads: [
          {
            id: 'lead-1',
            firstName: 'Aoife',
            lastName: 'Murphy',
            email: 'aoife@example.com',
            phone: null,
            status: 'new',
            source: 'facebook',
            sequenceId: null,
            assignedToId: null,
            createdAt: '2026-04-22T10:00:00.000Z',
            updatedAt: '2026-04-22T10:00:00.000Z',
          },
          {
            id: 'lead-2',
            firstName: 'Cian',
            lastName: 'Walsh',
            email: null,
            phone: '+353871234567',
            status: 'contacted',
            source: 'facebook',
            sequenceId: null,
            assignedToId: null,
            createdAt: '2026-04-21T10:00:00.000Z',
            updatedAt: '2026-04-21T10:00:00.000Z',
          },
        ],
        pageCount: 2,
        limit: 20,
        offset: 0,
      },
    }),
  },
];

export default fixture;
