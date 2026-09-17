import type { AssistantContext } from '../../services/get-context/get-context.service.js';
import type { ClaireFixture, HarnessToolStub } from '../types.js';

/**
 * Shared builder for the country-driven lead-form campaign fixtures
 * (US → Messenger, UK/Ireland → WhatsApp). NOT a `*.fixture.ts` file, so the
 * runner's discovery glob ignores it — the three thin fixture files import
 * from here.
 *
 * The flow under test is `create-campaign`'s lead-form-first default:
 *   Turn 1 — preview the offer + the lead-form campaign, and Claire tells the
 *            owner most leads land in the nurturing channel and that she works
 *            them.
 *   Turn 2 — on "yes", build the lead form + campaign (createLeadForm →
 *            createCampaign), then the creatives.
 *
 * Tool execution is stubbed; the eval verifies the LLM's tool sequence and
 * prose, with `previewCampaign` / `createLeadForm` returning the country's
 * channel so the assertion can check Claire surfaces it.
 */
export function buildLeadFormCampaignFixture(args: {
  id: string;
  country: string;
  address: string;
  /** 'Messenger' or 'WhatsApp' — the human label Claire should say. */
  channelLabel: 'Messenger' | 'WhatsApp';
  /** The nurtureChannel enum value the stubs return. */
  channel: 'messenger' | 'whatsapp';
}): { fixture: ClaireFixture; toolStubs: HarnessToolStub[] } {
  const orgContextOverrides: Partial<AssistantContext> = {
    address: args.address,
  };

  const fixture: ClaireFixture = {
    id: args.id,
    description: `Lead-form-first campaign for a ${args.country} clinic: the campaign defaults to a lead form whose follow-up chat is ${args.channelLabel}, and Claire tells the owner most leads land in ${args.channelLabel} where she handles them. On approval she builds the lead form, then the campaign.`,
    category: 'tool-dispatch',
    setup: {
      initialLoadedSkillIds: ['create-campaign'],
      orgContextOverrides,
    },
    turns: [
      {
        userMessage:
          'Run a lip filler campaign for me. I charge €180 a session.',
        expect: {
          toolsCalled: ['previewCampaign'],
          responseContains: [args.channelLabel],
        },
      },
      {
        userMessage: 'Perfect — yes, set it live.',
        expect: {
          toolsCalled: ['createLeadForm', 'createCampaign'],
        },
      },
    ],
  };

  const toolStubs: HarnessToolStub[] = [
    {
      name: 'checkMetaIntegration',
      respond: () => ({
        ok: true,
        data: {
          connected: true,
          hasAdAccount: true,
          hasFacebookPage: true,
          configurationComplete: true,
        },
      }),
    },
    {
      name: 'listServices',
      respond: () => ({
        ok: true,
        data: {
          services: [
            { id: 's1', name: 'Lip filler' },
            { id: 's2', name: 'Anti-wrinkle treatment' },
          ],
        },
      }),
    },
    {
      name: 'recommendServiceForAds',
      respond: () => ({
        ok: true,
        data: {
          recommended: {
            serviceId: 's1',
            name: 'Lip filler',
            rationale: 'Strong demand, short rebooking cycle, ready creative.',
          },
          alternatives: [{ serviceId: 's2', name: 'Anti-wrinkle treatment' }],
        },
      }),
    },
    {
      name: 'suggestIntroOffer',
      respond: () => ({
        ok: true,
        data: {
          advisable: true,
          needsPrice: false,
          suggested: {
            serviceId: 's1',
            serviceName: 'Lip filler',
            oneSessionPrice: 180,
            introPrice: 120,
            discountPercent: 33,
          },
        },
      }),
    },
    {
      name: 'previewCampaign',
      respond: () => ({
        ok: true,
        data: {
          uiState: 'created',
          variant: 'preview',
          title: 'Campaign preview',
          ready: true,
          suggestedName: 'Lip filler — June 2026',
          followUpType: 'lead_form',
          nurtureChannel: args.channel,
          nurtureChannelFlagged: false,
          canRunLeadForm: true,
          dailyBudgetAmount: 15,
          currencyCode: 'EUR',
          distanceKm: 20,
          ageMin: 18,
          ageMax: 65,
          locationName: args.address,
          areaTypeKnown: true,
          fields: [
            { label: 'Name', value: 'Lip filler — June 2026' },
            { label: 'Daily budget', value: '€15.00/day' },
            {
              label: 'How leads reach you',
              value: `Lead form → ${args.channelLabel} follow-up`,
            },
            { label: 'Targeting', value: `Within 20km of ${args.address}` },
            { label: 'Age range', value: '18–65' },
          ],
          actions: [],
        },
      }),
    },
    {
      name: 'createOffer',
      respond: () => ({
        ok: true,
        data: {
          offerId: 'o1',
          name: 'Lip filler intro',
          offerPriceCents: 12000,
        },
      }),
    },
    {
      name: 'createLeadForm',
      respond: () => ({
        ok: true,
        data: {
          leadFormId: 'lf1',
          metaFormId: 'm1',
          name: 'Lip filler — lead form',
          status: 'synced',
          followUpChannel: args.channel,
          ready: true,
        },
      }),
    },
    {
      name: 'createCampaign',
      respond: () => ({
        ok: true,
        data: {
          metaCampaignId: 'c1',
          metaAdSetId: 'as1',
          followUpType: 'lead_form',
          leadFormId: 'lf1',
        },
      }),
    },
    {
      name: 'createDraftVideo',
      respond: () => ({
        ok: true,
        data: { videoId: 'v1', status: 'rendering' },
      }),
    },
    {
      name: 'createAdGraphic',
      respond: () => ({
        ok: true,
        data: { graphicId: 'g1', status: 'rendering' },
      }),
    },
    {
      name: 'createDraftAd',
      respond: () => ({ ok: true, data: { adId: 'a1', status: 'draft' } }),
    },
    {
      name: 'setOrgDefault',
      respond: () => ({ ok: true, data: { ok: true } }),
    },
  ];

  return { fixture, toolStubs };
}
