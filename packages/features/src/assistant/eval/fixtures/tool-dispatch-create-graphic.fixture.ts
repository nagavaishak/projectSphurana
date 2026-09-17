import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Story 50 — create a social graphic in one call.
 *
 * Generate-graphic skill: "make me a social graphic for the lip filler
 * service" → Claire calls `createGraphic` immediately (no proposal turn, no
 * status tool afterwards). The returned card renders the image once the
 * server finishes; the skill explicitly forbids a separate confirmation or
 * status step.
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-create-graphic',
  description:
    'Generate-graphic skill: "make me a social graphic for the lip filler service" dispatches createGraphic directly in one call.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['generate-graphic'] },
  turns: [
    {
      userMessage: 'Make me a social graphic for the lip filler service.',
      expect: {
        toolsCalled: ['createGraphic'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'createGraphic',
    respond: () => ({
      ok: true,
      data: {
        graphicId: 'g-new-1',
        serviceId: 's1',
        category: 'injectables',
        kind: 'single',
        status: 'rendering',
        message: 'Graphic queued — it will appear in the card shortly.',
      },
    }),
  },
];

export default fixture;
