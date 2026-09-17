import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Read-by-status flow (fresha-clone). "Who were my no-shows this week?" routes
 * through `listAppointments` with a `status: no_show` filter — a read-only
 * lookup that surfaces the no-show list.
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-list-no-shows',
  description:
    'Manage-appointments skill: "who were my no-shows this week" dispatches listAppointments filtered by status no_show.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-appointments'] },
  turns: [
    {
      userMessage: 'Who were my no-shows this week?',
      expect: {
        toolsCalled: ['listAppointments'],
        responseContains: ['no-show'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'listAppointments',
    respond: () => ({
      ok: true,
      data: {
        items: [
          {
            id: 'appt-7',
            title: 'Facial with Aoife',
            startDate: '2026-05-12T10:00:00.000Z',
            endDate: '2026-05-12T10:30:00.000Z',
            status: 'no_show',
          },
          {
            id: 'appt-8',
            title: 'Lip filler with Niamh',
            startDate: '2026-05-14T15:00:00.000Z',
            endDate: '2026-05-14T15:30:00.000Z',
            status: 'no_show',
          },
        ],
        total: 2,
        limit: 50,
        offset: 0,
      },
    }),
  },
];

export default fixture;
