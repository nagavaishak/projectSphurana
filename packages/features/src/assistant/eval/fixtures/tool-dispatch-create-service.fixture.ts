import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Representative CRUD-dispatch fixture (story 50-family).
 *
 * Manage-services skill: "add a new service called X" follows the skill's
 * documented defaults-first create flow — Claire surfaces the proposed
 * record (name, category, description, status, pricing note) in one message
 * and asks accept-or-change. Only after the operator accepts does she
 * dispatch `createService`, which is destructive in the factory (it writes a
 * new service row) and lands a `confirmation_required` for the
 * `create_service` action.
 *
 * Observed model behaviour drove this two-turn shape: Claire does NOT create
 * blind on turn 1 — she proposes the full record and waits for sign-off. She
 * reads the existing catalogue straight from the business-context block
 * already in the system prompt (so she picks a fitting category without a
 * separate `listServices` call) and only writes after the operator confirms.
 * This fixture stands in for the whole wrapper-only CRUD family
 * (create/update/delete across services, leads, offers, etc.) — we exercise
 * the genuine propose-then-create flow once rather than re-testing the
 * factory's confirmation machinery per wrapper.
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-create-service',
  description:
    'Manage-services skill: "add a new service called Profhilo skin booster at €280" — Claire surfaces the proposed record on turn 1 and asks accept-or-change, then on confirmation dispatches createService, which lands a confirmation_required for create_service.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['manage-services'] },
  turns: [
    {
      userMessage:
        'Add a new service called Profhilo skin booster, priced from €280.',
      expect: {
        // Defaults-first: Claire proposes the full record and asks for
        // sign-off before writing — no createService on this turn.
        responseContains: ['Profhilo'],
      },
    },
    {
      userMessage: 'Yes, create it like that.',
      expect: {
        toolsCalled: ['createService'],
        confirmationPresented: 'create_service',
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
      title: 'Add service',
      fields: [
        { label: 'Name', value: String(input.name ?? 'Profhilo skin booster') },
        { label: 'Price', value: 'From €280' },
      ],
      resourceId: String(input.name ?? 'svc-new'),
    }),
    respond: (input) => ({
      ok: true,
      data: {
        id: 'svc-new-1',
        name: String(input.name ?? 'Profhilo skin booster'),
        category: 'injectables',
        isActive: true,
      },
    }),
  },
];

export default fixture;
