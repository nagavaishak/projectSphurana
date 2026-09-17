import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Cross-feature workflow fixture (W-C15-promote-flow).
 *
 * Exercises the `create-offer-and-promote-v1` composite skill end-to-end:
 *
 *   - Turn 1: user asks to create a promo offer and get it out there.
 *     Composite skill is pre-loaded via `initialLoadedSkillIds` (skips
 *     classifier non-determinism). Composite calls `meta_loadSkill` to
 *     bring in `manage-offers`, then `createOffer` lands a
 *     `confirmation_required` for the destructive action.
 *   - Turn 2: user confirms offer + asks for a promo video. Composite
 *     calls `createOffer` again (with confirmationToken) to execute, then
 *     `meta_loadSkill('generate-video')` to bring in the video skill,
 *     then `createDraftVideo` to start.
 *   - Turn 3: user asks to schedule the post. Composite calls
 *     `meta_loadSkill('schedule-post')`, then `createSocialPostDraft` and
 *     `confirmSchedulePost` to surface the scheduling confirmation.
 *
 * The shape of the test (which tools fire in which order, which skills
 * end up loaded, which confirmations surface) is what proves the cross-
 * feature orchestration works. The downstream creative content (script
 * text, caption, clip selection) is covered by the per-skill fixtures.
 *
 * Pre-loading via `initialLoadedSkillIds` rather than relying on the
 * classifier — flagged in the window brief's discoveries protocol that
 * the classifier may need a tighter `oneLineDescription` to disambiguate
 * the composite from the simpler `manage-offers` skill on prompts like
 * "make me a promo offer". Pre-load keeps the fixture deterministic and
 * decouples it from classifier accuracy work, which is C-04 territory.
 */
const fixture: ClaireFixture = {
  id: 'cross-feature-create-offer-and-promote',
  description:
    'Composite skill walks user from offer creation through video generation through post scheduling, loading each child skill on demand via meta_loadSkill.',
  category: 'mid-turn-skill',
  setup: { initialLoadedSkillIds: ['create-offer-and-promote-v1'] },
  turns: [
    {
      userMessage:
        'I want to run a promo for our new lip-filler service — 20% off for the next two weeks, and get the word out.',
      expect: {
        toolsCalled: ['meta_loadSkill', 'createOffer'],
        skillsLoaded: ['create-offer-and-promote-v1', 'manage-offers'],
        confirmationPresented: 'create_offer',
      },
    },
    {
      userMessage: 'Yes, create the offer. Then make me a promo video for it.',
      expect: {
        toolsCalled: ['createOffer', 'meta_loadSkill', 'createDraftVideo'],
        skillsLoaded: [
          'create-offer-and-promote-v1',
          'manage-offers',
          'generate-video',
        ],
      },
    },
    {
      userMessage:
        'Sounds good. Schedule the post for tomorrow morning when the video is ready.',
      expect: {
        toolsCalled: [
          'meta_loadSkill',
          'createSocialPostDraft',
          'confirmSchedulePost',
        ],
        skillsLoaded: [
          'create-offer-and-promote-v1',
          'manage-offers',
          'generate-video',
          'schedule-post',
        ],
        confirmationPresented: 'schedule_post',
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  // meta_loadSkill is built into the harness — no stub needed; the
  // harness resolves the skill via getSkillById and synthesises a
  // tool_result + mutates loadedSkillIds via applySideEffects.
  {
    name: 'createOffer',
    destructive: true,
    destructiveAction: 'create_offer',
    summarizeForConfirmation: (input) => ({
      title: 'Create offer',
      fields: [
        { label: 'Service', value: String(input.service ?? 'Lip filler') },
        { label: 'Discount', value: String(input.discount ?? '20%') },
        { label: 'Validity', value: String(input.validity ?? '2 weeks') },
      ],
      resourceId: String(input.offerId ?? 'offer-1'),
    }),
    respond: () => ({
      ok: true,
      data: {
        offerId: 'offer-1',
        service: 'Lip filler',
        discount: '20%',
        validUntil: '2026-05-09',
        isActive: true,
      },
    }),
  },
  {
    name: 'createDraftVideo',
    respond: () => ({
      ok: true,
      data: {
        videoId: 'v-promo-1',
        templateId: 'promo-offer',
        variationId: 'promo-offer-1',
        status: 'draft',
        narrationMode: 'recorded',
        recommendedClipCount: 3,
      },
    }),
  },
  {
    name: 'createSocialPostDraft',
    respond: () => ({
      ok: true,
      data: {
        postId: 'post-1',
        platforms: ['facebook', 'instagram'],
        status: 'draft',
        videoId: 'v-promo-1',
      },
    }),
  },
  {
    name: 'confirmSchedulePost',
    destructive: true,
    destructiveAction: 'schedule_post',
    summarizeForConfirmation: (input) => ({
      title: 'Schedule post',
      fields: [
        { label: 'Platforms', value: 'Facebook, Instagram' },
        {
          label: 'When',
          value: String(input.scheduledFor ?? '2026-04-26 09:00'),
        },
        { label: 'Asset', value: 'Lip-filler promo video' },
      ],
      resourceId: String(input.postId ?? 'post-1'),
    }),
    respond: () => ({ ok: true, data: { scheduled: true } }),
  },
];

export default fixture;
