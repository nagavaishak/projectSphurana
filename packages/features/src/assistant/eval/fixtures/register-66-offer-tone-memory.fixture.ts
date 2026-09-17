import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Register #66 (Phase 8 — capability honesty). Claire denied that she could
 * control/remember tone — but `meta_remember` (an always-loaded meta tool)
 * does exactly that. The capability manifest lists what she has, so the
 * correct behaviour when an owner asks her to remember a tone preference is to
 * CALL meta_remember and confirm, not to claim she can't.
 */
const fixture: ClaireFixture = {
  id: 'register-66-offer-tone-memory',
  description:
    'Tone-preference ask (register #66): Claire uses meta_remember to store the preference instead of denying she can control tone.',
  category: 'tool-dispatch',
  setup: { initialLoadedSkillIds: ['default'] },
  turns: [
    {
      userMessage:
        'From now on, write everything in a warmer, more casual tone — remember that.',
      expect: {
        toolsCalled: ['meta_remember'],
        responseContains: ['casual'],
        // No capability denial — the thing she claimed she couldn't do.
        responseLacks: ["can't", 'unable', "don't have the ability"],
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
        remembered: true,
        note: String(input.content ?? 'tone preference stored'),
      },
    }),
  },
];

export default fixture;
