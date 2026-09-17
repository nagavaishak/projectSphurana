import {
  type GetMetaIntegrationResponse,
  type ListWhatsAppAccountsResponse,
  getMetaIntegrationResponseSchema,
  listWhatsAppAccountsResponseSchema,
} from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import {
  getOrgDefaults,
  targetingRadiusKmForAreaType,
} from '@borradh-workspace/features/org-defaults';
import {
  getPrimaryLocation,
  resolveOrgPrivacyPolicyUrl,
} from '@borradh-workspace/features/organizations';
import {
  type ClinicAreaType,
  clinicAreaTypeValues,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { adAccountCurrency } from '../_shared/ad-currency.js';
import { resolveOrgNurtureChannel } from '../lead-forms/_nurture.js';

type MetaIntegrationApiResponse = GetMetaIntegrationResponse;

/**
 * A WhatsApp account only counts as usable for ads when it's active AND its
 * token is still valid. A connection that "needs reconnect" is effectively
 * disabled — counting it as connected makes Claire default to a WhatsApp
 * campaign that Meta then rejects.
 */
function hasUsableWhatsApp(wa: ListWhatsAppAccountsResponse): boolean {
  return (
    Array.isArray(wa.accounts) &&
    wa.accounts.some(
      (a) => a.isActive !== false && a.tokenStatus !== 'needs_reconnect'
    )
  );
}

interface PreviewField {
  label: string;
  value: string;
}

/**
 * `uiState: 'created' + variant: 'preview'` is the generic card shape the
 * frontend renders via the dispatch in `tool-renderer.tsx`. Keying off the
 * data shape (not the tool name) means the card persists on refresh — the
 * renderer just reads the tool output from message history.
 *
 * `ready: false` returns are also shaped so they render visibly as a preview
 * card with the error reason as a single field, so the operator sees the
 * blocker after a refresh instead of an empty trace.
 */
interface PreviewCampaignOutput {
  uiState: 'created';
  variant: 'preview';
  title: string;
  fields: PreviewField[];
  // Empty array — per user preference (2026-05-17) we don't show action
  // buttons on creation/preview cards.
  actions: [];
  // Non-render fields the LLM reads to make follow-up decisions.
  ready: boolean;
  reason?: string;
  suggestedName?: string;
  followUpType?: 'chatbot' | 'lead_form';
  /**
   * For the lead-form default: the country-driven nurturing channel the form's
   * thank-you button points at. Claire tells the owner "most leads land in
   * {Messenger/WhatsApp} — I'll handle them."
   */
  nurtureChannel?: 'messenger' | 'whatsapp';
  /** True when the country prefers WhatsApp but it isn't connected (→ Messenger). */
  nurtureChannelFlagged?: boolean;
  nurtureChannelReason?: string;
  /** Whether the org can run a lead form (has a privacy-policy URL). */
  canRunLeadForm?: boolean;
  /**
   * Set when a lead form was wanted but can't be built (e.g. no privacy-policy
   * URL). Claire relays this and falls back to the chatbot flow.
   */
  leadFormBlockedReason?: string;
  destinations?: ('whatsapp' | 'messenger' | 'instagram_dm')[];
  /**
   * Which messaging destinations the org can ACTUALLY run, based on what's
   * connected: Messenger is always present, WhatsApp only when a WhatsApp
   * account is connected, Instagram DM only when the Page has a linked IG
   * account. Claire must not pick a destination that isn't in this list.
   */
  availableDestinations?: ('whatsapp' | 'messenger' | 'instagram_dm')[];
  destinationLabel?: string;
  dailyBudgetAmount?: number;
  currencyCode?: string;
  distanceKm?: number;
  ageMin?: number;
  ageMax?: number;
  locationName?: string;
  /**
   * Whether the org's catchment (city vs countryside) is on file. When
   * `false`, the radius is the neutral default and the skill should ask the
   * owner once — "city/town or countryside?" — then persist via setOrgDefault
   * (key `adAreaType`) so the radius is right and never asked again.
   */
  areaTypeKnown?: boolean;
  areaType?: ClinicAreaType | null;
  /** Whether the org has a real address on file for the targeting line. */
  hasAddress?: boolean;
  /** `meta_ads_page.page_name` is a nullable column. */
  pageName?: string | null;
  /**
   * Soft issues the LLM should surface before proceeding. Each warning is a
   * plain-English sentence the model can relay to the owner. If non-empty,
   * the model should address these before calling createCampaign.
   */
  warnings?: string[];
}

const DEFAULT_DAILY_BUDGET_AMOUNT = 15;
const DEFAULT_AGE_MIN = 18;
const DEFAULT_AGE_MAX = 65;

function destinationLabelFor(
  destinations: ('whatsapp' | 'messenger' | 'instagram_dm')[]
): string {
  if (destinations.includes('whatsapp')) return 'WhatsApp';
  if (destinations.includes('messenger')) return 'Messenger';
  if (destinations.includes('instagram_dm')) return 'Instagram DM';
  return 'Messenger';
}

/**
 * Default campaign name when the operator gave no name and no context to
 * derive one from. Date + time keeps it unique even if the operator creates
 * several in the same session, and it sorts naturally in the Meta dashboard.
 * Operators can rename after creation.
 */
function defaultCampaignName(
  followUpType: 'chatbot' | 'lead_form',
  now: Date = new Date()
): string {
  const datePart = new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(now);
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  const prefix = followUpType === 'lead_form' ? 'Lead Form' : 'Campaign';
  return `${prefix} — ${datePart} ${hh}:${mm}`;
}

function notReadyCard(reason: string): { data: PreviewCampaignOutput } {
  return {
    data: {
      uiState: 'created',
      variant: 'preview',
      title: "Can't preview a campaign yet",
      fields: [{ label: 'Reason', value: reason }],
      actions: [],
      ready: false,
      reason,
    },
  };
}

/**
 * `meta_ads_previewCampaign` — gather all the defaults the Create Campaign
 * modal would auto-fill, without making any Meta calls. The LLM uses this
 * to echo the proposed defaults into chat, then ask "create with these?".
 * Only after the user approves does the LLM call `createCampaign`.
 *
 * Read-only. Idempotent. Safe to call multiple times in a conversation if
 * the user keeps changing their mind.
 */
export const previewCampaignTool = defineTool<
  {
    requestedName?: string;
    requestedDailyBudgetAmount?: number;
    requestedFollowUpType?: 'chatbot' | 'lead_form';
    requestedDistanceKm?: number;
    suppressCard?: boolean;
  },
  PreviewCampaignOutput
>({
  feature: 'meta-ads',
  action: 'previewCampaign',
  description:
    'Resolve the defaults the Create Campaign modal would apply (suggested ' +
    'name, daily budget, follow-up type, destination, targeting), without ' +
    'creating anything on Meta. Use this BEFORE calling createCampaign so ' +
    'you can echo the defaults to the user and ask them to approve. Pass ' +
    'whatever the user named (requestedName, requestedDailyBudgetAmount, ' +
    'requestedFollowUpType) — the tool fills the rest from defaults. ' +
    'Check the `warnings` array in the response — if non-empty, address ' +
    'each issue with the user before proceeding to createCampaign.',
  inputSchema: z.object({
    requestedName: z
      .string()
      .optional()
      .describe('What the user called the campaign, if anything.'),
    requestedDailyBudgetAmount: z
      .number()
      .positive()
      .optional()
      .describe(
        'The budget the user named, in whole/decimal units of the ' +
          'ad-account currency (not euros), if any.'
      ),
    requestedFollowUpType: z
      .enum(['chatbot', 'lead_form'])
      .optional()
      .describe(
        'Only set if the user explicitly asked for one. Default is a lead ' +
          'form (when the org has a privacy-policy URL), else chatbot.'
      ),
    requestedDistanceKm: z
      .number()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'Targeting radius in km, if the owner named one. Usually leave unset ' +
          'and let the tool derive it from the org’s saved catchment ' +
          '(city→20km, countryside→40km). Set the catchment once via ' +
          'setOrgDefault key adAreaType.'
      ),
    suppressCard: z
      .boolean()
      .optional()
      .describe(
        'Set true to read the campaign signals WITHOUT rendering a preview ' +
          'card in the chat — used by the create-campaign flow, which builds ' +
          'immediately and shows only the createCampaign card. The tool output ' +
          'is unchanged; the frontend just renders nothing.'
      ),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Resolving defaults' },
  additionalAllowedPaths: [
    /^integrations\/meta-ads\/integration$/,
    /^integrations\/whatsapp\/accounts$/,
    /^assistant\/context$/,
    /^organizations$/,
    /^organizations\/[a-zA-Z0-9_-]+$/,
  ],
  execute: async (input, ctx) => {
    let integrationResp: MetaIntegrationApiResponse;
    try {
      integrationResp = await ctx.apiFetch(
        'integrations/meta-ads/integration',
        { schema: getMetaIntegrationResponseSchema }
      );
    } catch {
      return notReadyCard(
        "Meta isn't connected for this org. Open Settings → Integrations to connect it, then ask me again."
      );
    }

    const integration = integrationResp.integration;
    if (
      !integration ||
      integration.tokenStatus === 'needs_reconnect' ||
      integration.configurationStatus !== 'configured'
    ) {
      return notReadyCard(
        "Meta isn't connected for this org. Open Settings → Integrations to connect it, then ask me again."
      );
    }

    const activePages = integration.pages.filter((p) => p.isActive);
    const defaultPage =
      activePages.find((p) => p.id === integration.defaultPageId) ??
      activePages[0];
    if (!defaultPage) {
      return notReadyCard(
        'No active Facebook page is configured. Open Settings → Integrations to pick one.'
      );
    }

    // Currency is the connected ad account's currency (what Meta bills in);
    // `adAccountCurrency` falls back to EUR when it's missing OR not a 2-decimal
    // currency, so the budget math and symbol stay consistent.
    const { currency } = adAccountCurrency(
      defaultPage.defaultAdAccountCurrency
    );
    const currencyCode = currency.code;
    const currencySymbol = currency.symbol;

    // The acquisition default is a LEAD FORM (lower friction, higher intent)
    // whose thank-you button drops the lead into a country-driven chat channel
    // Claire then works. Meta hard-requires a privacy-policy URL on the form, so
    // we resolve one from the org's dedicated policy → website → Facebook Page →
    // the org's own connected Facebook Page (resolveOrgPrivacyPolicyUrl). Since
    // every Meta advertiser has a connected Page, this essentially always
    // resolves; it only comes back empty when Meta isn't connected at all, in
    // which case we fall back to click-to-chat.
    let canRunLeadForm = false;
    try {
      canRunLeadForm = !!(await resolveOrgPrivacyPolicyUrl(
        db,
        ctx.organizationId
      ));
    } catch {
      // best-effort — treated as "can't run a lead form"
    }

    const followUpType: 'chatbot' | 'lead_form' =
      input.requestedFollowUpType ?? (canRunLeadForm ? 'lead_form' : 'chatbot');

    // When a lead form is wanted but can't be built (no policy, website OR
    // Facebook Page to use), tell the skill why so it offers the chatbot
    // fallback rather than silently downgrading.
    const leadFormBlockedReason =
      followUpType === 'lead_form' && !canRunLeadForm
        ? "I can't run a lead form without a privacy-policy link (Meta requires one) — and I couldn't find a website or Facebook Page to use. I can run a message-us campaign instead, or you can add a website or privacy-policy URL in Settings → Business."
        : undefined;

    // Resolve the lead-form nurturing channel (country-driven) for the preview.
    let nurtureChannel: 'messenger' | 'whatsapp' | undefined;
    let nurtureChannelFlagged: boolean | undefined;
    let nurtureChannelReason: string | undefined;
    if (followUpType === 'lead_form') {
      const nurture = await resolveOrgNurtureChannel(ctx);
      nurtureChannel = nurture.channel;
      nurtureChannelFlagged = nurture.flagged;
      nurtureChannelReason = nurture.flagged ? nurture.reason : undefined;
    }

    // Match the in-app Create Campaign dialog: Messenger is the always-available
    // default (any connected Page can run a Messenger ad). WhatsApp and
    // Instagram DM are only OFFERED when the org actually has them connected —
    // Claire never defaults to a destination the org can't run, which is what
    // caused the "Page not linked to a WhatsApp Business Account" failure.
    let destinations: ('whatsapp' | 'messenger' | 'instagram_dm')[] = [];
    let hasWhatsApp = false;
    const hasInstagramLinked = !!defaultPage.linkedInstagramAccountId;
    if (followUpType === 'chatbot') {
      try {
        const wa = await ctx.apiFetch('integrations/whatsapp/accounts', {
          schema: listWhatsAppAccountsResponseSchema,
        });
        hasWhatsApp = hasUsableWhatsApp(wa);
      } catch {
        hasWhatsApp = false;
      }
      // Default to WhatsApp WHEN it's connected (higher intent, gets seen like
      // SMS), else Messenger. `availableDestinations` below tells the skill
      // what else it could switch to. If WhatsApp turns out not to be linked at
      // the Page level, createCampaign auto-falls back to Messenger.
      destinations = hasWhatsApp ? ['whatsapp'] : ['messenger'];
    }
    const availableDestinations: ('whatsapp' | 'messenger' | 'instagram_dm')[] =
      followUpType === 'chatbot'
        ? [
            'messenger',
            ...(hasWhatsApp ? (['whatsapp'] as const) : []),
            ...(hasInstagramLinked ? (['instagram_dm'] as const) : []),
          ]
        : [];

    // One org-defaults read covers both the daily budget and the saved
    // catchment (city vs countryside) that drives the targeting radius.
    let dailyBudgetAmount = input.requestedDailyBudgetAmount;
    let areaType: ClinicAreaType | null = null;
    try {
      const defaults = await getOrgDefaults(db, {
        organizationId: ctx.organizationId,
      });
      if (defaults.success) {
        if (
          dailyBudgetAmount === undefined &&
          defaults.data.adDailyBudgetCents != null
        ) {
          dailyBudgetAmount = defaults.data.adDailyBudgetCents / 100;
        }
        areaType = defaults.data.adAreaType;
      }
    } catch {
      // best-effort
    }
    if (dailyBudgetAmount === undefined) {
      dailyBudgetAmount = DEFAULT_DAILY_BUDGET_AMOUNT;
    }

    // Radius: explicit owner request wins, else derive from the saved
    // catchment (city→20km, countryside→40km, unknown→25km neutral default).
    const areaTypeKnown =
      areaType !== null &&
      (clinicAreaTypeValues as readonly string[]).includes(areaType);
    const distanceKm =
      input.requestedDistanceKm ?? targetingRadiusKmForAreaType(areaType);

    // Anchor the targeting line on the org's PRIMARY LOCATION (the row with the
    // real street/town + lat/lng), not the often-empty org-level address field.
    // The actual Meta targeting resolves the same primary location at create
    // time, so the preview and the live radius agree.
    let locationName: string | undefined;
    try {
      const loc = await getPrimaryLocation(db, {
        organizationId: ctx.organizationId,
      });
      if (loc.success && loc.data) {
        locationName = loc.data.label;
      }
    } catch {
      // best-effort — the preview just omits the geo line if the lookup fails.
    }

    const suggestedName =
      input.requestedName?.trim() || defaultCampaignName(followUpType);

    const destinationLabel = destinationLabelFor(destinations);
    const budgetLine = `${currencySymbol}${dailyBudgetAmount.toFixed(2)}/day`;
    const nurtureLabel =
      nurtureChannel === 'whatsapp' ? 'WhatsApp' : 'Messenger';
    const howLeadsReachYou =
      followUpType === 'chatbot'
        ? `Messaging via ${destinationLabel}`
        : `Lead form → ${nurtureLabel} follow-up`;
    const targetingLine = locationName
      ? `Within ${distanceKm}km of ${locationName}`
      : `Within ${distanceKm}km of your clinic (add your address in Settings so this shows the exact place)`;

    const fields: PreviewField[] = [
      { label: 'Name', value: suggestedName },
      { label: 'Daily budget', value: budgetLine },
      { label: 'How leads reach you', value: howLeadsReachYou },
      { label: 'Targeting', value: targetingLine },
      {
        label: 'Age range',
        value: `${DEFAULT_AGE_MIN}–${DEFAULT_AGE_MAX}`,
      },
    ];

    const warnings: string[] = [];
    if (!locationName) {
      warnings.push(
        'No clinic address on file — targeting will fall back to country-level. ' +
          'Add your address in Settings → Business for precise local targeting.'
      );
    }
    if (!areaTypeKnown) {
      warnings.push(
        `I don't know your catchment area yet (city or countryside), so the radius is set to a neutral ${distanceKm}km default. Tell me your area type so I can dial it in.`
      );
    }
    if (leadFormBlockedReason) {
      warnings.push(leadFormBlockedReason);
    }
    if (nurtureChannelFlagged && nurtureChannelReason) {
      warnings.push(nurtureChannelReason);
    }

    return {
      data: {
        uiState: 'created',
        variant: 'preview',
        title: 'Campaign preview',
        fields,
        actions: [],
        ready: true,
        suggestedName,
        followUpType,
        nurtureChannel,
        nurtureChannelFlagged,
        nurtureChannelReason,
        canRunLeadForm,
        leadFormBlockedReason,
        destinations,
        availableDestinations,
        destinationLabel,
        dailyBudgetAmount,
        currencyCode,
        distanceKm,
        ageMin: DEFAULT_AGE_MIN,
        ageMax: DEFAULT_AGE_MAX,
        locationName,
        areaTypeKnown,
        areaType,
        hasAddress: locationName !== undefined,
        pageName: defaultPage.pageName,
        ...(warnings.length > 0 ? { warnings } : {}),
      },
    };
  },
});
