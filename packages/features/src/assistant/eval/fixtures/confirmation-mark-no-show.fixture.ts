import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * No-show flow (fresha-clone). The operator reports a customer didn't turn up;
 * Claire dispatches `markNoShow`, which is destructive and lands a
 * `confirmation_required` for the `mark_no_show` action. The synthetic stub
 * mirrors the factory two-call shape and surfaces the two guardrail facts the
 * skill always shows: the slot is freed, and a no-show fee may apply per policy
 * (not auto-charged).
 */
const fixture: ClaireFixture = {
  id: 'confirmation-mark-no-show',
  description:
    'Manage-appointments skill: "Sarah didn\'t show for her 2pm" routes through markNoShow, which lands a confirmation_required for mark_no_show and surfaces the slot-reopen + fee guardrail.',
  category: 'confirmation',
  setup: { initialLoadedSkillIds: ['manage-appointments'] },
  turns: [
    {
      userMessage:
        "Sarah Doyle didn't turn up for her 2pm today — mark it as a no-show.",
      expect: {
        confirmationPresented: 'mark_no_show',
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'markNoShow',
    destructive: true,
    destructiveAction: 'mark_no_show',
    summarizeForConfirmation: (input) => ({
      title: 'Mark no-show',
      fields: [
        {
          label: 'Customer',
          value: String(input.customerDisplayName ?? 'Sarah Doyle'),
        },
        { label: 'Slot', value: String(input.slotDisplay ?? 'Today 14:00') },
        {
          label: 'Effect',
          value: 'Frees the slot for re-booking; no practitioner notification.',
        },
        {
          label: 'No-show fee',
          value: 'Per your cancellation policy (not charged automatically).',
        },
      ],
      resourceId: String(input.appointmentId ?? 'appt-1'),
    }),
    respond: () => ({
      ok: true,
      data: { appointmentId: 'appt-1', status: 'no_show' },
    }),
  },
];

export default fixture;
