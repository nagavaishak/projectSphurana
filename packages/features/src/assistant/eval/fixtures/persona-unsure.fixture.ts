import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'persona-unsure',
  description:
    'When uncertain, Claire admits it and asks a clarifying question rather than guessing.',
  category: 'persona',
  setup: { initialLoadedSkillIds: ['default'] },
  turns: [
    {
      userMessage: 'Can you do the thing?',
      expect: {
        // Either she asks a clarifying question OR explicitly admits she
        // doesn't know what's being asked. Match either signal.
        responseContains: ['?'],
        responseLacks: ['!'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [];
export default fixture;
