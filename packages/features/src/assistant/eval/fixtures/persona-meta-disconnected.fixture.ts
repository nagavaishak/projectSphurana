import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Story 81 — Meta disconnected: Claire gates the ad flow on integration.
 *
 * The create-ad skill's first step is "Check Meta is connected. Call
 * `checkMetaIntegration`. If disconnected or unconfigured, respond with a
 * connect-then-retry message and STOP." This fixture drives that branch:
 * the stub reports `connected: false`, so Claire must tell the operator to
 * connect Meta first and must NOT proceed to `createDraftAd` / `createCampaign`.
 *
 * Disconnected state is represented purely in the tool result here
 * (`checkMetaIntegration` → `{ connected: false, ... }`), mirroring the
 * connected-state stub in `tool-dispatch-recommend-service-for-ads`.
 */
const fixture: ClaireFixture = {
  id: 'persona-meta-disconnected',
  description:
    'Meta disconnected: checkMetaIntegration reports connected:false, so Claire tells the operator to connect Meta in Settings → Integrations and stops, rather than creating a draft ad.',
  category: 'persona',
  setup: { initialLoadedSkillIds: ['create-ad'] },
  turns: [
    {
      userMessage: 'Run a lip filler ad for me.',
      expect: {
        toolsCalled: ['checkMetaIntegration'],
        responseContains: ['connect'],
        // Must not pretend it built/launched anything, and must not move on
        // to draft/campaign creation.
        responseLacks: [
          "i've created",
          'draft is ready',
          'launched',
          'campaign is live',
        ],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'checkMetaIntegration',
    respond: () => ({
      ok: true,
      data: {
        connected: false,
        hasAdAccount: false,
        hasFacebookPage: false,
        configurationComplete: false,
      },
    }),
  },
];

export default fixture;
