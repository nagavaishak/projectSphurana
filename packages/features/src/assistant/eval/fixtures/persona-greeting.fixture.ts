import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'persona-greeting',
  description:
    'Plain greeting — Claire introduces herself with the v3 persona, no fluff.',
  category: 'persona',
  setup: { initialLoadedSkillIds: ['default'] },
  turns: [
    {
      userMessage: 'Hi',
      expect: {
        responseContains: ['claire'],
        // The default skill prompt forbids exclamation marks and the
        // "just" softener; verify the model doesn't reach for them.
        responseLacks: ['!', 'just '],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [];
export default fixture;
