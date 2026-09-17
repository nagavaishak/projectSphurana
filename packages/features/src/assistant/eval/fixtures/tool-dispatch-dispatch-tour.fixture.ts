import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Story 2 — "show me around" → tour dispatch.
 *
 * `meta_dispatchTour` is an always-loaded meta tool (mirrors `metaTools` in
 * apps/api). When the operator asks for a tour / to be shown around, Claire
 * calls it with a `tourKind`; the harness's built-in meta handling emits a
 * `tour_dispatch` presentation with the matching navigation target. The
 * fixture asserts the dispatch reaches `meta_dispatchTour`.
 *
 * No tool stub is supplied — the harness has built-in handling for
 * `meta_dispatchTour` (see `invokeStub` in harness.ts), same as
 * `meta_loadSkill`.
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-dispatch-tour',
  description:
    'Operator asks to be shown around ("give me a tour"); Claire dispatches the always-loaded meta_dispatchTour meta tool, which emits a tour_dispatch presentation.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['default'] },
  turns: [
    {
      userMessage: "I'm new here — show me around and give me a quick tour.",
      expect: {
        toolsCalled: ['meta_dispatchTour'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [];

export default fixture;
