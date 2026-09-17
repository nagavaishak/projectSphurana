import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Phase 3 (Time Correctness) — audit register #193: "this week" was queried
 * against 2025 because the model did its own date arithmetic on a training
 * prior. Now the model passes the `this_week` PRESET and the server resolves it
 * from the real clock in the org timezone; the resolved window is echoed on the
 * result, and Claire reports the resolved absolute range — never a 2025 one.
 *
 * No customer data — synthetic org + campaign.
 */
const fixture: ClaireFixture = {
  id: 'register-193-insights-this-week',
  description:
    'Optimise-ads skill: "how did our ads do this week?" passes the this_week preset to getCampaignInsights; the server-resolved range (2026-07-27 → 2026-08-02) is echoed and Claire reports the resolved window, not a training-prior year.',
  category: 'tool-dispatch',
  setup: {
    initialLoadedSkillIds: ['optimise-ads'],
    orgContextOverrides: { timezone: 'Europe/Dublin' },
  },
  turns: [
    {
      userMessage: 'How did our ads do this week?',
      expect: {
        toolsCalled: ['getCampaignInsights'],
        responseContains: ['2026-07-27', '2026-08-02'],
        // The reported window must be backed by the tool's resolved range, not
        // invented — and never a 2025 date.
        claimsRequireToolSupport: [
          { phrase: '2026-07-27', support: '2026-07-27' },
        ],
        responseLacks: ['2025'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'getCampaignInsights',
    respond: () => ({
      ok: true,
      data: {
        metaCampaignId: 'c-1',
        // Server-resolved from "this week" in Europe/Dublin (real clock).
        dateRange: { since: '2026-07-27', until: '2026-08-02' },
        totals: {
          spend: 210,
          reach: 8400,
          clicks: 190,
          impressions: 12000,
          leads: 14,
          conversions: 3,
          ctr: 1.58,
          cpc: 110,
          cpm: 1750,
          frequency: 1.4,
          cpl: 1500,
          cpa: 7000,
        },
        ads: [],
      },
    }),
  },
];

export default fixture;
