import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'classifier-leads',
  description:
    'Classifier routes "show me my leads" to the manage-leads skill.',
  category: 'classifier',
  turns: [
    {
      userMessage: 'Show me my leads from this week.',
      expect: {
        skillsLoaded: ['manage-leads'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [];
export default fixture;
