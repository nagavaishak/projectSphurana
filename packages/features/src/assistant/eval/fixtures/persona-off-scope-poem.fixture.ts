import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'persona-off-scope-poem',
  description:
    'Generic creative ask ("write me a poem") unrelated to clinic marketing — Claire declines politely, calls no tools, and steers back to scope instead of playing general-purpose chatbot.',
  category: 'persona',
  setup: { initialLoadedSkillIds: ['default'] },
  turns: [
    {
      userMessage:
        'Write me a poem about my dog Bailey for his birthday party.',
      expect: {
        responseContains: ['scope'],
        responseLacks: ['Bailey,\n', 'roses are red'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [];
export default fixture;
