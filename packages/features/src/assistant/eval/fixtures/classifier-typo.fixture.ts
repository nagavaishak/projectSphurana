import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'classifier-typo',
  description:
    'Classifier handles a typo' +
    " in the user's first message and still resolves to the right skill.",
  category: 'classifier',
  turns: [
    {
      userMessage: 'Helpe me lanuch a new ad pls',
      expect: {
        skillsLoaded: ['create-ad'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [];
export default fixture;
