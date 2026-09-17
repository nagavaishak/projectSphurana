import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Phase 3 (Time Correctness) — audit register #208: a booking was attempted for
 * a date a full year in the past because the model resolved "tomorrow" against
 * its 2025 training prior. Now the model passes the word "tomorrow" and the
 * server resolves it from the real clock in the org timezone; the resolved
 * `queryDate` is echoed and Claire answers with the correct-year date.
 *
 * No customer data — synthetic availability.
 */
const fixture: ClaireFixture = {
  id: 'register-208-slots-tomorrow',
  description:
    'Manage-appointments skill: "any openings tomorrow?" passes the word "tomorrow" to findOpenSlots; the server resolves it to 2026-07-30 (correct year) in the org timezone and echoes it as queryDate. Claire answers with the resolved date, never a training-prior year.',
  category: 'tool-dispatch',
  setup: {
    initialLoadedSkillIds: ['manage-appointments'],
    orgContextOverrides: { timezone: 'Europe/Dublin' },
  },
  turns: [
    {
      userMessage: 'Any openings tomorrow?',
      expect: {
        toolsCalled: ['findOpenSlots'],
        responseContains: ['2026-07-30'],
        claimsRequireToolSupport: [
          { phrase: '2026-07-30', support: '2026-07-30' },
        ],
        responseLacks: ['2025'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'findOpenSlots',
    respond: () => ({
      ok: true,
      data: {
        available: true,
        // Resolved from "tomorrow" in Europe/Dublin from the real clock.
        queryDate: '2026-07-30',
        slots: [
          {
            date: '2026-07-30',
            startTime: '10:00',
            endTime: '10:45',
            displayTime: '10:00 AM',
            isoStart: '2026-07-30T09:00:00.000Z',
            isoEnd: '2026-07-30T09:45:00.000Z',
            practitionerName: 'Niamh',
          },
        ],
        provider: 'google_calendar',
        message: 'One open slot tomorrow.',
      },
    }),
  },
];

export default fixture;
