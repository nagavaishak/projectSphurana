import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'persona-out-of-scope',
  description:
    'Out-of-scope ask (legal advice) — Claire refuses and points the user to a qualified human.',
  category: 'persona',
  setup: { initialLoadedSkillIds: ['default'] },
  turns: [
    {
      userMessage:
        'My accountant just left me and I need help filing my Irish corporate tax return.',
      expect: {
        responseContains: ['scope'],
        responseLacks: ['!'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [];
export default fixture;
