import type { ClaireFixture, HarnessToolStub } from '../types.js';

const fixture: ClaireFixture = {
  id: 'mid-turn-skill-load',
  description:
    'User starts with ad creation, then pivots mid-conversation to scheduling a post. Claire calls meta_loadSkill to pull in schedule-post; the harness verifies the skill is loaded by end of turn.',
  category: 'mid-turn-skill',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage:
        'Actually forget the ad — schedule a post for the lip filler video instead.',
      expect: {
        toolsCalled: ['meta_loadSkill'],
        skillsLoaded: ['create-ad', 'schedule-post'],
      },
    },
  ],
};

// meta_loadSkill is built into the harness — no stub needed; the harness
// resolves the skill via getSkillById and synthesises a tool_result.
export const toolStubs: HarnessToolStub[] = [];

export default fixture;
