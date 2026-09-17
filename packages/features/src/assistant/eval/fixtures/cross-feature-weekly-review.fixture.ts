import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Cross-feature workflow fixture (W-C15-weekly-review).
 *
 * Exercises the `weekly-marketing-review` composite skill end-to-end on a
 * single turn:
 *
 *   - Composite skill is pre-loaded via `initialLoadedSkillIds` (skips
 *     classifier non-determinism).
 *   - Composite calls `meta_loadSkill` four times in sequence, alternating
 *     with the corresponding summary tool from each child skill:
 *       1. meta_loadSkill('manage-leads')          → summariseRecentLeads
 *       2. meta_loadSkill('optimise-ads')          → suggestAdOptimizations
 *       3. meta_loadSkill('manage-customer-chats') → summariseConversationsThisWeek
 *       4. meta_loadSkill('manage-appointments')   → summariseUpcomingDay
 *   - Final assistant text is a tight 4-section read (Leads / Ads /
 *     Customer chats / Appointments) ending with one specific suggestion.
 *
 * The fixture's main job is to prove the cross-feature orchestration
 * works: tools fire in the right order, skills end up loaded by end of
 * turn, and the final response carries all four section markers without
 * apology phrases. The downstream creative content (specific copy,
 * exact numbers) is covered by the per-skill fixtures.
 *
 * Pre-loading via `initialLoadedSkillIds` rather than relying on the
 * classifier — flagged in the window brief's discoveries protocol that
 * the classifier may need a tighter `oneLineDescription` to disambiguate
 * the composite from the simpler `manage-leads` skill on prompts like
 * "how are leads going". Pre-load keeps the fixture deterministic and
 * decouples it from classifier accuracy work, which is C-04 territory.
 */
const fixture: ClaireFixture = {
  id: 'cross-feature-weekly-review',
  description:
    'Composite skill walks through leads → ads → customer chats → appointments summary tools, loading each child skill on demand via meta_loadSkill, then synthesises a tight 4-section weekly read.',
  category: 'mid-turn-skill',
  setup: { initialLoadedSkillIds: ['weekly-marketing-review'] },
  turns: [
    {
      userMessage: 'Give me my weekly read.',
      expect: {
        toolsCalled: [
          'meta_loadSkill',
          'summariseRecentLeads',
          'meta_loadSkill',
          'suggestAdOptimizations',
          'meta_loadSkill',
          'summariseConversationsThisWeek',
          'meta_loadSkill',
          'summariseUpcomingDay',
        ],
        skillsLoaded: [
          'weekly-marketing-review',
          'manage-leads',
          'optimise-ads',
          'manage-customer-chats',
          'manage-appointments',
        ],
        // Tight 4-section read — every section header appears, plus the
        // closing concrete suggestion. Substring match is case-insensitive.
        responseContains: [
          'Leads',
          'Ads',
          'Customer chats',
          'Appointments',
          "I'd",
        ],
        // Brevity-as-brand assertions. None of the apology / hedging
        // phrases the prompt fragment explicitly forbids should appear.
        responseLacks: ['unfortunately', 'apologise', 'apologize'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  // meta_loadSkill is built into the harness — no stub needed; the harness
  // resolves the skill via getSkillById and synthesises a tool_result +
  // mutates loadedSkillIds via applySideEffects.
  {
    name: 'summariseRecentLeads',
    respond: () => ({
      ok: true,
      data: {
        timeframe: 'this_week',
        windowStart: '2026-04-18T00:00:00.000Z',
        windowEnd: '2026-04-25T00:00:00.000Z',
        totalLeads: 18,
        previousLeads: 14,
        deltaPercent: 28,
        byStatus: {
          new: 8,
          contacted: 6,
          qualified: 3,
          won: 1,
          lost: 0,
        },
        bySource: { facebook: 11, instagram: 5, website: 2 },
        topLeads: [
          {
            id: 'lead-aoife',
            firstName: 'Aoife',
            lastName: 'Kennedy',
            email: 'aoife@example.com',
            phone: null,
            status: 'contacted',
            source: 'facebook',
            createdAt: '2026-04-24T11:00:00.000Z',
          },
        ],
      },
    }),
  },
  {
    name: 'suggestAdOptimizations',
    respond: () => ({
      ok: true,
      data: {
        timeframe: 'last_7_days',
        activeCampaigns: 3,
        totals: {
          spend: 1260,
          leads: 30,
          cplAverage: 42,
        },
        recommendations: [
          {
            adId: 'ad-lip-filler-1',
            adName: 'Lip filler — winter',
            kind: 'creative_refresh',
            reason: 'Frequency 4.2; CTR fell from 1.8% to 0.9% week-over-week.',
            severity: 'high',
          },
        ],
        warnings: [],
      },
    }),
  },
  {
    name: 'summariseConversationsThisWeek',
    respond: () => ({
      ok: true,
      data: {
        timeframe: {
          since: '2026-04-18T00:00:00.000Z',
          until: '2026-04-25T00:00:00.000Z',
        },
        counts: {
          totalThreads: 14,
          openThreads: 5,
          escalatedThreads: 1,
          closedThreads: 8,
        },
        byChannel: {
          whatsapp: 6,
          facebook_messenger: 5,
          instagram_dm: 3,
        },
        topIntents: [],
        responseTime: { p50Ms: 720_000, p95Ms: 9_000_000 },
        oldestPending: {
          conversationId: 'conv-stale-james',
          customerName: 'James Carter',
          channel: 'facebook_messenger',
          hoursPending: 30,
        },
      },
    }),
  },
  {
    name: 'summariseUpcomingDay',
    respond: () => ({
      ok: true,
      data: {
        date: '2026-04-26',
        totalScheduled: 5,
        totalCancelled: 0,
        totalCompleted: 0,
        totalNoShow: 0,
        byPractitioner: [
          {
            practitionerLabel: 'Niamh',
            appointmentCount: 4,
            earliest: '2026-04-26T09:00:00.000Z',
            latest: '2026-04-26T15:30:00.000Z',
          },
          {
            practitionerLabel: 'Aoife',
            appointmentCount: 1,
            earliest: '2026-04-26T11:00:00.000Z',
            latest: '2026-04-26T11:30:00.000Z',
          },
        ],
        upcoming: [],
      },
    }),
  },
];

export default fixture;
