import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Guided pending-ad build fixture (user stories 13–19 + 84).
 *
 * Exercises the multi-turn, field-by-field ad builder Claire drives with the
 * `claire_setPendingAd*` mutator tools + `claire_showAdPreview`. Each turn the
 * operator adds or overrides one facet of the draft ad; the draft is a single
 * server-side row keyed by `(organizationId, conversationId)`, so every
 * mutation accumulates onto the same draft. The final turn renders the preview
 * card, which must reflect ALL accumulated fields — proving the pending-ad
 * state persists across turns.
 *
 * Why the live-controller path (and not the in-process features harness):
 * the `claire_setPendingAd*` / `claire_showAdPreview` tool implementations live
 * in `apps/api/src/assistant/tools/claire/`, outside the features package, so
 * the in-process harness can't host them. The live-controller adapter offers
 * any fixture-stubbed tool name unconditionally (see
 * `controller-pipeline-adapter.ts#buildToolMap`), so the stubs below stand in
 * for the real claire tools while still flowing through the real
 * `runToolLoop` + SSE pipeline.
 *
 * The stubs share a module-level `draft` accumulator: each mutator merges its
 * field into the draft and echoes the full snapshot back, exactly like the
 * real `updateDraftAd` round-trip. `claire_showAdPreview` reads the accumulated
 * draft and emits a `preview_card` presentation, so the final turn's assertions
 * can verify the headline override, targeting, budget, price and creative all
 * survived into the preview.
 *
 * Skill wiring note: no skill currently lists the `setPendingAd*` tools in its
 * `toolNames`, so they are not classifier-routable in production. This fixture
 * deliberately leans on the adapter's unconditional stub-offering to validate
 * the builder tools themselves; it does NOT assert any `skillsLoaded`. See the
 * report accompanying this fixture for the wiring gap.
 */

interface DraftAccumulator {
  draftId: string;
  name: string;
  headline: string | null;
  primaryText: string | null;
  serviceIds: string[];
  videoId: string | null;
  metaCampaignId: string | null;
  targeting: Record<string, unknown> | null;
  dailyBudgetCents: number | null;
  introPrice: number | null;
  startDate: string | null;
  endDate: string | null;
  status: string;
}

// Module-level draft row — mirrors the single server-side draft keyed by
// (organizationId, conversationId). Every `setPendingAd*` stub mutates THIS
// object, so later turns build on earlier ones.
const draft: DraftAccumulator = {
  draftId: 'draft-lip-filler-001',
  name: 'Lip filler — June 2026',
  headline: null,
  primaryText: null,
  serviceIds: ['svc-lip-filler'],
  videoId: 'vid-lip-filler-ready',
  metaCampaignId: 'camp-lip-filler-001',
  targeting: null,
  dailyBudgetCents: null,
  introPrice: null,
  startDate: null,
  endDate: null,
  status: 'draft',
};

const snapshot = () => ({
  draftId: draft.draftId,
  name: draft.name,
  headline: draft.headline,
  primaryText: draft.primaryText,
  serviceIds: draft.serviceIds,
  videoId: draft.videoId,
  metaCampaignId: draft.metaCampaignId,
  targeting: draft.targeting,
  dailyBudgetCents: draft.dailyBudgetCents,
  introPrice: draft.introPrice,
  startDate: draft.startDate,
  endDate: draft.endDate,
  status: draft.status,
});

const fixture: ClaireFixture = {
  id: 'cross-feature-build-pending-ad',
  description:
    'Guided multi-turn pending-ad build for the lip-filler service: copy → headline override → targeting → budget+schedule → intro price → preview. Proves the draft-ad state persists and accumulates across turns into the final preview card.',
  category: 'tool-dispatch',
  // The `claire_setPendingAd*` / `claire_showAdPreview` tools live in apps/api,
  // so this fixture is only runnable via the live-controller eval — the
  // in-process replay harness skips it (it has no replayable recording).
  harness: 'live-controller',
  // No skill is pre-loaded: the `create-ad` skill prompt steers Claire to the
  // one-shot `createDraftAd` flow and never mentions the field-by-field
  // `setPendingAd*` builder tools (they are not in any skill's `toolNames`).
  // Pre-loading it makes the model ignore the builder tools entirely. With an
  // empty list the classifier is skipped (adapter only classifies turn 0 when
  // `initialLoadedSkillIds` is undefined) and only `default` is active, so the
  // stubbed builder tools — offered unconditionally by the adapter — are the
  // only ad-shaped tools Claire sees.
  setup: { initialLoadedSkillIds: [] },
  turns: [
    {
      // Story 13/14 — draft the ad copy for the lip-filler video.
      userMessage: 'Draft me an ad for the lip filler video.',
      expect: {
        toolsCalled: ['claire_setPendingAdCopy'],
      },
    },
    {
      // Story 15 — override just the headline.
      userMessage:
        'Change the headline to "Naturally fuller lips, Dublin\'s trusted clinic".',
      expect: {
        toolsCalled: ['claire_setPendingAdHeadline'],
      },
    },
    {
      // Story 16 — set targeting (radius around the clinic).
      userMessage:
        'Target a 20km radius around the clinic, women aged 25 to 45.',
      expect: {
        toolsCalled: ['claire_setPendingAdTargeting'],
      },
    },
    {
      // Story 17 — daily budget + run window.
      userMessage:
        'Set the daily budget to €25 and run it from June 10th to June 30th.',
      expect: {
        toolsCalled: ['claire_setPendingAdBudget'],
      },
    },
    {
      // Story 18 — intro price for the offer in the ad.
      userMessage: 'Add an intro price of €150.',
      expect: {
        toolsCalled: ['claire_setPendingAdPrice'],
      },
    },
    {
      // Story 19/84 — show the full ad preview; must reflect everything above.
      userMessage: 'Show me the full ad.',
      expect: {
        toolsCalled: ['claire_showAdPreview'],
      },
    },
  ],
};

export const toolStubs: HarnessToolStub[] = [
  {
    name: 'claire_setPendingAdCopy',
    respond: (input) => {
      if (typeof input.headline === 'string') draft.headline = input.headline;
      else if (!draft.headline) draft.headline = 'Fuller lips, expertly done';
      if (typeof input.caption === 'string') draft.primaryText = input.caption;
      else if (!draft.primaryText)
        draft.primaryText =
          'Subtle, natural lip enhancement from our Grafton Street clinic. Book a consultation today.';
      return { ok: true, data: snapshot() };
    },
  },
  {
    name: 'claire_setPendingAdHeadline',
    respond: (input) => {
      if (typeof input.headline === 'string') draft.headline = input.headline;
      return { ok: true, data: snapshot() };
    },
  },
  {
    name: 'claire_setPendingAdCaption',
    respond: (input) => {
      if (typeof input.caption === 'string') draft.primaryText = input.caption;
      return { ok: true, data: snapshot() };
    },
  },
  {
    name: 'claire_setPendingAdCreative',
    respond: (input) => {
      if (typeof input.videoId === 'string') draft.videoId = input.videoId;
      return { ok: true, data: snapshot() };
    },
  },
  {
    name: 'claire_setPendingAdTargeting',
    respond: (input) => {
      draft.targeting = {
        ...(typeof input.latitude === 'number'
          ? { latitude: input.latitude }
          : {}),
        ...(typeof input.longitude === 'number'
          ? { longitude: input.longitude }
          : {}),
        ...(typeof input.distanceKm === 'number'
          ? { distanceKm: input.distanceKm }
          : {}),
        ...(typeof input.ageMin === 'number' ? { ageMin: input.ageMin } : {}),
        ...(typeof input.ageMax === 'number' ? { ageMax: input.ageMax } : {}),
        ...(Array.isArray(input.genders) ? { genders: input.genders } : {}),
      };
      return { ok: true, data: snapshot() };
    },
  },
  {
    name: 'claire_setPendingAdBudget',
    respond: (input) => {
      if (typeof input.dailyBudgetCents === 'number')
        draft.dailyBudgetCents = input.dailyBudgetCents;
      return { ok: true, data: snapshot() };
    },
  },
  {
    name: 'claire_setPendingAdSchedule',
    respond: (input) => {
      if (typeof input.startDate === 'string')
        draft.startDate = input.startDate;
      if (typeof input.endDate === 'string') draft.endDate = input.endDate;
      return { ok: true, data: snapshot() };
    },
  },
  {
    name: 'claire_setPendingAdPrice',
    respond: (input) => {
      if (typeof input.introPrice === 'number')
        draft.introPrice = input.introPrice;
      return { ok: true, data: snapshot() };
    },
  },
  {
    name: 'claire_showAdPreview',
    respond: () => {
      const state = snapshot();
      const missing: string[] = [];
      if (!state.videoId) missing.push('creative');
      if (!state.metaCampaignId) missing.push('campaign');
      if (!state.headline) missing.push('headline');
      if (!state.serviceIds || state.serviceIds.length === 0)
        missing.push('serviceIds');
      return {
        ok: true,
        data: {
          draftId: state.draftId,
          ready: missing.length === 0,
          missing,
        },
        presentation: {
          type: 'preview_card',
          kind: 'ad',
          draftId: state.draftId,
          state: state as unknown as Record<string, unknown>,
        } as unknown as never,
      };
    },
  },
];

export default fixture;
