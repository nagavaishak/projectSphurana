import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Cross-feature workflow fixture (W-C15-cpl-response).
 *
 * Exercises the `respond-to-low-cpl` composite skill end-to-end across two
 * turns:
 *
 *   - Turn 1: operator says "my CPL is up this week, what's going on?".
 *     Composite skill is pre-loaded via `initialLoadedSkillIds` (skips
 *     classifier non-determinism). Composite calls
 *     `meta_loadSkill('optimise-ads')` to bring in the ads skill, then
 *     `suggestAdOptimizations` to pull the picture. Final assistant text
 *     diagnoses the worst campaign with concrete numbers (spend, leads,
 *     CPL, frequency, days post-learning) and proposes pausing it.
 *   - Turn 2: operator says "yeah, pause the worst one". Composite calls
 *     `meta_loadSkill('pause-ad')` to bring in the narrow pause skill,
 *     then `confirmPauseAd` which lands a `confirmation_required`
 *     presentation for action `pause_ad`. The actual `executePauseAd`
 *     fires from the frontend's `addToolOutput` confirmation flow — the
 *     fixture's job is to prove the diagnose-then-confirm chain works.
 *
 * The fixture's main job is to prove the diagnose-first decision tree:
 * the composite calls into `optimise-ads` for data BEFORE recommending
 * any action, and routes to the right narrow skill (`pause-ad` here)
 * once the data warrants it. The tone-check assertions enforce the
 * brief's "no apology phrases when delivering bad news" rule and
 * "diagnose first; don't lead with `more budget`" guidance.
 *
 * Pre-loading via `initialLoadedSkillIds` rather than relying on the
 * classifier — flagged in the window brief's discoveries protocol that
 * the classifier may confuse this with `optimise-ads` for ambiguous
 * prompts ("optimise my ads"). Pre-load keeps the fixture deterministic
 * and decouples it from classifier accuracy work, which is C-04
 * territory.
 */
const fixture: ClaireFixture = {
  id: 'cross-feature-respond-to-low-cpl',
  description:
    'Composite skill diagnoses ad performance via optimise-ads, then routes the operator into pause-ad with a confirmation card on a worst-performing post-learning campaign.',
  category: 'mid-turn-skill',
  setup: { initialLoadedSkillIds: ['respond-to-low-cpl'] },
  turns: [
    {
      userMessage: "My CPL is up this week, what's going on?",
      expect: {
        toolsCalled: ['meta_loadSkill', 'suggestAdOptimizations'],
        skillsLoaded: ['respond-to-low-cpl', 'optimise-ads'],
        // Diagnose-first: response surfaces the worst campaign with its
        // numbers, not a generic "let me check" line.
        responseContains: ['Anti-wrinkle', 'CPL', 'pause'],
        // Tone rules from the brief: no apology phrases when delivering
        // bad news; don't reach for "more budget" as the default fix.
        responseLacks: [
          'unfortunately',
          'apologise',
          'apologize',
          'more budget',
        ],
      },
    },
    {
      userMessage: 'Yeah, pause the worst one.',
      expect: {
        toolsCalled: ['meta_loadSkill', 'confirmPauseAd'],
        skillsLoaded: ['respond-to-low-cpl', 'optimise-ads', 'pause-ad'],
        confirmationPresented: 'pause_ad',
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  // meta_loadSkill is built into the harness — no stub needed; the
  // harness resolves the skill via getSkillById and synthesises a
  // tool_result + mutates loadedSkillIds via applySideEffects.
  {
    name: 'suggestAdOptimizations',
    respond: () => ({
      ok: true,
      data: {
        timeframe: 'last_7_days',
        activeCampaigns: 2,
        totals: {
          spend: 720,
          leads: 12,
          cplAverage: 60,
        },
        recommendations: [
          {
            adId: 'ad-anti-wrinkle-2',
            adName: 'Anti-wrinkle quick result',
            kind: 'pause',
            reason:
              'CPL €78 (target €25); 14 days post-learning, frequency 2.1, only 4 leads on €420 spend.',
            severity: 'high',
            inLearningPhase: false,
            daysSinceLaunch: 21,
            frequency: 2.1,
            spend: 420,
            leads: 4,
            cpl: 78,
          },
          {
            adId: 'ad-skin-booster-1',
            adName: 'Skin booster — Q2',
            kind: 'maintain',
            reason: 'CPL €32, performing within range.',
            severity: 'low',
            inLearningPhase: false,
            daysSinceLaunch: 18,
            frequency: 1.8,
            spend: 300,
            leads: 8,
            cpl: 32,
          },
        ],
        warnings: [],
      },
    }),
  },
  {
    name: 'confirmPauseAd',
    destructive: true,
    destructiveAction: 'pause_ad',
    summarizeForConfirmation: (input) => ({
      title: 'Pause campaign',
      fields: [
        {
          label: 'Campaign',
          value: String(input.campaignName ?? 'Anti-wrinkle quick result'),
        },
        { label: 'Spend last 7 days', value: '€420' },
        { label: 'Leads', value: '4' },
        { label: 'CPL', value: '€78' },
      ],
      resourceId: String(input.adId ?? 'ad-anti-wrinkle-2'),
    }),
    respond: () => ({ ok: true, data: { paused: true } }),
  },
];

export default fixture;
