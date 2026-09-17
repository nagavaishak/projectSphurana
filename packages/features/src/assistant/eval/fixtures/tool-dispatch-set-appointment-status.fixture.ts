import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Day-of check-in flow (fresha-clone). "Mark Aoife as arrived" routes through
 * the NON-destructive `setAppointmentStatus` tool — a routine lifecycle
 * transition with no confirmation gate (unlike no-show / cancel).
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-set-appointment-status',
  description:
    'Manage-appointments skill: "mark Aoife as arrived" dispatches setAppointmentStatus (non-destructive lifecycle progression) — no confirmation.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-appointments'] },
  turns: [
    {
      userMessage: "Aoife's here — mark her 2pm as arrived.",
      expect: {
        toolsCalled: ['setAppointmentStatus'],
        responseContains: ['arrived'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'setAppointmentStatus',
    respond: () => ({
      ok: true,
      data: { appointmentId: 'appt-6', status: 'arrived' },
    }),
  },
];

export default fixture;
