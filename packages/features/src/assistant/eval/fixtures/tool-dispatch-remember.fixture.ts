import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Story 3 — "remember that…" → meta_remember.
 *
 * `meta_remember` is the always-loaded meta tool that stores a stable
 * preference/fact for future conversations. When the operator states a clear
 * standing preference ("we don't run ads on Sundays"), Claire calls
 * `meta_remember` with the fact. The fixture asserts the write reaches
 * `meta_remember` and that Claire confirms it noted the preference.
 *
 * Note on scope: `meta_remember` is an always-loaded meta tool in production
 * (`apps/api/src/assistant/tools/meta/index.ts` `metaTools` includes
 * `rememberTool`, exposed on every turn regardless of `loadedSkillIds`). The
 * eval harness mirrors that by listing it in `META_TOOL_NAMES` so the model
 * actually receives it as an available tool in record mode. Unlike
 * `meta_loadSkill`/`meta_dispatchTour`, it has no built-in harness handler,
 * so the stub below resolves its result in record mode. In replay mode the
 * recorded result is read verbatim.
 *
 * Cross-SESSION recall (the fact surfacing as injected knowledge in a brand
 * new conversation) is RAG-driven and lives outside this in-process harness,
 * so it can't be exercised here. Turn 2 instead confirms WITHIN-session
 * recall: Claire answers from conversation history without re-storing.
 */
const fixture: ClaireFixture = {
  id: 'tool-dispatch-remember',
  description:
    'Operator states a standing preference ("we don\'t run ads on Sundays"); Claire stores it via meta_remember. Turn 2 confirms within-session recall without a second write. Cross-session RAG recall is out of harness scope.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['default'] },
  turns: [
    {
      userMessage: 'Remember that we never run ads on Sundays.',
      expect: {
        toolsCalled: ['meta_remember'],
        responseContains: ['Sunday'],
      },
    },
    {
      userMessage: 'Which day did I say we skip ads on?',
      expect: {
        // Within-session recall: answer from history, don't re-store.
        responseContains: ['Sunday'],
        responseLacks: ['saved that'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'meta_remember',
    respond: (input) => ({
      ok: true,
      data: {
        stored: true,
        scope: typeof input.scope === 'string' ? input.scope : 'personal',
        content: String(input.content ?? "We don't run ads on Sundays."),
      },
    }),
  },
];

export default fixture;
