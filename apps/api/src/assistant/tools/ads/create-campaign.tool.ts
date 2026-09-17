import {
  type CreateMetaCampaignResponse,
  type GetMetaIntegrationResponse,
  type ListWhatsAppAccountsResponse,
  createMetaCampaignResponseSchema,
  getMetaIntegrationResponseSchema,
  listWhatsAppAccountsResponseSchema,
} from '@borradh-workspace/contracts';
import { db } from '@borradh-workspace/database';
import {
  findSimilarCampaigns,
  recordActionIntent,
} from '@borradh-workspace/features/assistant';
import {
  getOrgDefaults,
  targetingRadiusKmForAreaType,
} from '@borradh-workspace/features/org-defaults';
import {
  type ClinicAreaType,
  followUpTypeLabels,
  messagingDestinationLabels,
} from '@borradh-workspace/labels';
import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';
import { adAccountCurrency } from '../_shared/ad-currency.js';

const messagingDestination = z.enum(['whatsapp', 'messenger', 'instagram_dm']);
const followUpType = z.enum(['chatbot', 'lead_form']);

/**
 * Radius only. There is deliberately NO place, latitude or longitude here.
 *
 * This tool used to ask the model for coordinates ("use Geocoding from the user
 * message if they named a city"), which is how an ad ran targeted at Null
 * Island off West Africa (register #82). The campaign's geo now comes from the
 * business's saved, geocoded branch, resolved by the API. The owner still
 * chooses how far — that is a real preference, not an address.
 */
const targetingSchema = z
  .object({
    distanceKm: z.number().min(1).max(500).optional(),
  })
  .optional();

const createCampaignInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(200)
    .describe(
      'Human-readable campaign name shown in Meta Ads Manager (e.g. "Botox — September").'
    ),
  dailyBudgetAmount: z
    .number()
    .positive()
    .optional()
    .describe(
      'Daily budget in whole/decimal units of the ad-account currency (e.g. ' +
        '15, 25.50) — NOT euros; the currency is resolved from the connected ' +
        'Meta ad account. Defaults to 15 if the user did not name a number. ' +
        "Don't ask — pick the default."
    ),
  followUpType: followUpType
    .optional()
    .describe(
      'How leads reach the business. "chatbot" = the ad opens a chat (WhatsApp / ' +
        'Messenger / Instagram DM). "lead_form" = the ad shows a Meta lead form. ' +
        'DEFAULT is "chatbot" — only pass "lead_form" if the user explicitly asked ' +
        'for a lead form / form fill / contact form.'
    ),
  destinations: z
    .array(messagingDestination)
    .optional()
    .describe(
      'Only used when followUpType="chatbot". Which messaging surfaces the ad ' +
        'opens. If omitted, the tool auto-selects: WhatsApp if the org has it ' +
        "connected, otherwise Messenger. Don't ask the user — let the default run."
    ),
  leadFormId: z
    .string()
    .min(1)
    .optional()
    .describe(
      'Only used when followUpType="lead_form". The lead form to attach. If the ' +
        'user said "lead form" but did not pick one, call listLeadForms first to ' +
        'pick one, or ask for a name if there are several similarly named.'
    ),
  targeting: targetingSchema.describe(
    "How far the ad should reach. The AREA is always the business's saved " +
      'address — you cannot set it here and must not try to. Only set ' +
      'distanceKm when the owner names a radius; otherwise omit this entirely ' +
      'and their saved catchment decides.'
  ),
  createAnyway: z
    .boolean()
    .optional()
    .describe(
      'Set true ONLY after the tool returned existing_candidates and the user ' +
        'explicitly confirmed they want a NEW campaign anyway (not to reuse an ' +
        'existing similar one). Leaving it unset lets the tool surface recent ' +
        'near-duplicate campaigns first so the owner does not create a second ' +
        'campaign on the same budget by accident.'
    ),
});

type MetaIntegrationApiResponse = GetMetaIntegrationResponse;
type CreateCampaignApiResponse = CreateMetaCampaignResponse;

/**
 * A WhatsApp account only counts as usable for ads when it's active AND its
 * token is valid — a "needs reconnect" connection is effectively disabled.
 */
function hasUsableWhatsApp(wa: ListWhatsAppAccountsResponse): boolean {
  return (
    Array.isArray(wa.accounts) &&
    wa.accounts.some(
      (a) => a.isActive !== false && a.tokenStatus !== 'needs_reconnect'
    )
  );
}

interface CreatedField {
  label: string;
  value: string;
}

interface SimilarCampaignCandidate {
  id: string;
  name: string;
  createdAt: string;
  matchReasons: string[];
}

interface CreateCampaignOutput {
  uiState: 'created' | 'error' | 'existing_candidates';
  title?: string;
  message?: string;
  fields?: CreatedField[];
  /**
   * Set when the pre-create dedupe (Phase 4 #79 #151) found recent, similar
   * campaigns. Creation was NOT performed — Claire must surface these and
   * only re-call with `createAnyway: true` if the owner confirms a new one.
   */
  existingCandidates?: SimilarCampaignCandidate[];
  proposedName?: string;
  /**
   * Always an empty array for createCampaign — the renderer hides the
   * action row when there are no buttons. Kept on the type for compatibility
   * with the generic Created-card dispatch.
   */
  actions?: [];
  campaignId?: string;
  name?: string;
  status?: string;
  dailyBudget?: number | null;
  /**
   * Set when WhatsApp was requested/defaulted but the Page isn't linked to a
   * WhatsApp Business Account, so the campaign was created with Messenger
   * instead. Claire relays this so the owner knows to link WhatsApp if they
   * want it. Not an error — the campaign exists and works.
   */
  whatsappFallbackNote?: string;
  error?: string;
}

const DEFAULT_DAILY_BUDGET_AMOUNT = 15;

function formatBudget(cents: number, currencySymbol: string): string {
  return `${currencySymbol}${(cents / 100).toFixed(2)}/day`;
}

function statusLabel(raw: string): string {
  const normalized = raw.toLowerCase();
  if (normalized === 'paused') return 'Paused — no spend yet';
  if (normalized === 'active') return 'Active';
  if (normalized === 'draft') return 'Draft';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function destinationFieldValue(destinations: string[]): string {
  if (destinations.length === 0) return 'Messaging';
  return destinations
    .map(
      (d) =>
        messagingDestinationLabels[
          d as keyof typeof messagingDestinationLabels
        ] ?? d
    )
    .join(', ');
}

/**
 * `meta_ads_createCampaign` — create a new Meta Ads campaign that mirrors the
 * Create Campaign modal in apps/app.
 *
 * Non-destructive: campaign is created with status=PAUSED so no spend begins
 * until an operator launches an ad inside it. The LLM never sees Meta's
 * internal `OUTCOME_*` enum strings — `followUpType` is the human surface,
 * and the tool maps it to `OUTCOME_ENGAGEMENT` / `OUTCOME_LEADS` server-side.
 *
 * Defaults the modal applies (and this tool replicates):
 *   - dailyBudget €15
 *   - followUpType "chatbot" (messaging)
 *   - destinations: WhatsApp if connected, else Messenger
 *   - distanceKm 25, ageMin 18, ageMax 65
 *   - metaAdsPageId: the org's default page
 *
 * Returns a `uiState: 'created'` payload so the chat renders a Created card
 * with friendly labels (no `OUTCOME_*`, no `PAUSED`) and inline edit
 * affordances ("Add an ad", "Change budget", "Make €X/day my default").
 */
export const createCampaignTool = defineTool<
  z.infer<typeof createCampaignInputSchema>,
  CreateCampaignOutput
>({
  feature: 'meta-ads',
  action: 'createCampaign',
  description:
    'Create a new Meta Ads campaign (paused on creation — no spend begins ' +
    'until an ad is launched inside it). Mirrors the in-app Create Campaign ' +
    'modal. Defaults are aggressive — pass only the fields the user actually ' +
    'named: dailyBudgetAmount (default 15, in the ad-account currency), ' +
    'followUpType (default "chatbot" ' +
    'meaning the ad opens a chat — "lead_form" only when the user explicitly ' +
    'asked for a form), destinations (auto: WhatsApp if connected, else ' +
    'Messenger), targeting (auto from org address). The tool resolves the ' +
    "page, WhatsApp availability, and currency itself — don't pre-fetch them. " +
    'If a near-duplicate campaign was created recently the tool returns ' +
    "uiState 'existing_candidates' instead of creating one — show those to the " +
    'owner and only re-call with createAnyway:true if they confirm a new one.',
  inputSchema: createCampaignInputSchema,
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Creating campaign' },
  additionalAllowedPaths: [
    /^meta-campaigns$/,
    /^meta-campaigns\/[a-zA-Z0-9_-]+$/,
    /^integrations\/meta-ads\/integration$/,
    /^integrations\/whatsapp\/accounts$/,
  ],
  execute: async (input, ctx) => {
    const requestedFollowUpType: 'chatbot' | 'lead_form' =
      input.followUpType ?? 'chatbot';

    // 0. Pre-create dedupe (Phase 4 #79 #151). Before spending any Meta calls,
    // check the recent action-intent log for a near-duplicate campaign the
    // owner just created. If one is found and the model hasn't been told to
    // create anyway, surface the candidates instead of silently creating a
    // second campaign on the same budget. Best-effort — a lookup failure must
    // never block a legitimate create.
    const dedupeObjective =
      requestedFollowUpType === 'chatbot'
        ? 'OUTCOME_ENGAGEMENT'
        : 'OUTCOME_LEADS';
    if (!input.createAnyway) {
      try {
        const similar = await findSimilarCampaigns(db, {
          organizationId: ctx.organizationId,
          name: input.name,
          objective: dedupeObjective,
        });
        if (similar.success && similar.data.candidates.length > 0) {
          const existingCandidates: SimilarCampaignCandidate[] =
            similar.data.candidates.map((c) => ({
              id: c.resourceId ?? c.id,
              name: c.displayName ?? 'Untitled campaign',
              createdAt: c.createdAt,
              matchReasons: c.matchReasons,
            }));
          return {
            data: {
              uiState: 'existing_candidates',
              title: 'You may already have this campaign',
              message: `You created ${existingCandidates.length} similar campaign${existingCandidates.length === 1 ? '' : 's'} recently. Do you want to reuse one of those, or create a brand-new campaign anyway? I will not create a duplicate unless you say so.`,
              proposedName: input.name,
              existingCandidates,
            },
            presentation: {
              type: 'existing_candidates',
              kind: 'campaign',
              proposedName: input.name,
              candidates: existingCandidates,
            },
          };
        }
      } catch {
        // Non-fatal — proceed with creation.
      }
    }

    // 1. Resolve the default Meta page + currency. Without an active page we
    // can't post the campaign, so surface a soft error the model can relay.
    let integrationResponse: MetaIntegrationApiResponse;
    try {
      integrationResponse = await ctx.apiFetch(
        'integrations/meta-ads/integration',
        { schema: getMetaIntegrationResponseSchema }
      );
    } catch (error) {
      return {
        data: {
          uiState: 'error',
          error:
            error instanceof Error
              ? error.message
              : 'Could not check Meta connection.',
        },
      };
    }

    const integration = integrationResponse.integration;
    if (
      !integration ||
      integration.tokenStatus === 'needs_reconnect' ||
      integration.configurationStatus !== 'configured'
    ) {
      return {
        data: {
          uiState: 'error',
          error:
            "Meta Ads isn't connected for this org. Open Settings → " +
            'Integrations to connect it, then ask me again.',
        },
      };
    }

    const activePages = integration.pages.filter((p) => p.isActive);
    const defaultPage =
      activePages.find((p) => p.id === integration.defaultPageId) ??
      activePages[0];

    if (!defaultPage) {
      return {
        data: {
          uiState: 'error',
          error:
            'No active Facebook page is configured. Open Settings → ' +
            'Integrations to pick one.',
        },
      };
    }

    // Currency is the connected ad account's currency (what Meta bills in);
    // `adAccountCurrency` falls back to EUR when it's missing OR not a 2-decimal
    // currency (the ×100 budget math below only holds for 2-decimal). Symbol and
    // amount derive from this single value so nothing can disagree.
    const currencySymbol = adAccountCurrency(
      defaultPage.defaultAdAccountCurrency
    ).currency.symbol;
    const hasInstagram = !!defaultPage.linkedInstagramAccountId;

    // 2. Resolve destinations for chatbot campaigns. Mirror the in-app Create
    // Campaign dialog: Messenger is the always-available default; WhatsApp and
    // Instagram DM are only usable when the org has them connected. We NEVER
    // send a destination the org can't run — picking WhatsApp when the Page
    // isn't linked to a WhatsApp Business Account is what made Meta reject the
    // ad set.
    let destinations: ('whatsapp' | 'messenger' | 'instagram_dm')[] = [];
    if (requestedFollowUpType === 'chatbot') {
      let hasWhatsApp = false;
      try {
        const wa = await ctx.apiFetch('integrations/whatsapp/accounts', {
          schema: listWhatsAppAccountsResponseSchema,
        });
        hasWhatsApp = hasUsableWhatsApp(wa);
      } catch {
        hasWhatsApp = false;
      }
      const isAvailable = (
        d: 'whatsapp' | 'messenger' | 'instagram_dm'
      ): boolean => {
        if (d === 'whatsapp') return hasWhatsApp;
        if (d === 'instagram_dm') return hasInstagram;
        return true; // messenger always available with a connected Page
      };

      if (input.destinations && input.destinations.length > 0) {
        // Honour an explicit request, but drop anything not connected so we
        // never try to run (e.g.) an Instagram-DM ad the org can't deliver.
        destinations = input.destinations.filter(isAvailable);
      } else {
        // Default to WhatsApp WHEN connected, else Messenger.
        destinations = hasWhatsApp ? ['whatsapp'] : ['messenger'];
      }
      // Fallback when the requested destinations were all unavailable.
      if (destinations.length === 0) {
        destinations = ['messenger'];
      }
    }

    // 3. Pull org defaults: the default budget (when the user didn't name a
    // number) and the saved catchment (city vs countryside) that drives the
    // targeting radius. One read covers both.
    let dailyBudgetCents: number | null =
      input.dailyBudgetAmount !== undefined
        ? Math.round(input.dailyBudgetAmount * 100)
        : null;
    let areaType: ClinicAreaType | null = null;
    try {
      const defaults = await getOrgDefaults(db, {
        organizationId: ctx.organizationId,
      });
      if (defaults.success) {
        if (
          dailyBudgetCents === null &&
          defaults.data.adDailyBudgetCents != null
        ) {
          dailyBudgetCents = defaults.data.adDailyBudgetCents;
        }
        areaType = defaults.data.adAreaType;
      }
    } catch {
      // Org defaults are best-effort — fall through to the static defaults.
    }
    if (dailyBudgetCents === null) {
      dailyBudgetCents = DEFAULT_DAILY_BUDGET_AMOUNT * 100;
    }

    // 4. Compute objective server-side from the human follow-up type.
    const objective =
      requestedFollowUpType === 'chatbot'
        ? 'OUTCOME_ENGAGEMENT'
        : 'OUTCOME_LEADS';

    // 5. Targeting knobs. The AREA is not decided here at all: the API resolves
    // the business's saved branch and centres the radius on its geocoded
    // coordinates. If that branch cannot be placed on a map the API refuses
    // with an actionable message, which surfaces through the catch below —
    // deliberately, because the alternative this replaced was guessing a
    // country, and a guessed country is what once pointed US and UK clinics'
    // spend at Ireland.
    const targeting = {
      ageMin: 18,
      ageMax: 65,
      // Owner-named radius wins; otherwise derive from the saved catchment
      // (city→20km, countryside→40km, unknown→25km neutral default).
      distanceKm:
        input.targeting?.distanceKm ?? targetingRadiusKmForAreaType(areaType),
    };

    const buildBody = (
      dests: ('whatsapp' | 'messenger' | 'instagram_dm')[]
    ): Record<string, unknown> => {
      const b: Record<string, unknown> = {
        name: input.name,
        objective,
        metaAdsPageId: defaultPage.id,
        dailyBudget: dailyBudgetCents,
        followUpType: requestedFollowUpType,
        targeting,
      };
      if (requestedFollowUpType === 'chatbot') {
        b.destinations = dests;
        b.conversionDestination = dests.includes('whatsapp')
          ? 'whatsapp'
          : 'messenger';
      } else if (input.leadFormId) {
        b.leadFormId = input.leadFormId;
      }
      return b;
    };

    // Meta rejects a WhatsApp ad set when the Facebook Page isn't linked to a
    // WhatsApp Business Account — the org can have a WhatsApp account connected
    // to Borradh yet still not have the Page-level link Meta needs. Detect that
    // and auto-fall back to Messenger rather than failing the whole campaign.
    const isWhatsAppNotLinked = (err: unknown): boolean =>
      err instanceof Error && /whatsapp business account/i.test(err.message);

    let campaign: CreateCampaignApiResponse;
    let whatsappFallback = false;
    try {
      campaign = await ctx.apiFetch('meta-campaigns', {
        method: 'POST',
        body: buildBody(destinations),
        schema: createMetaCampaignResponseSchema,
      });
    } catch (error) {
      if (destinations.includes('whatsapp') && isWhatsAppNotLinked(error)) {
        // Retry once with Messenger so the campaign still gets created.
        try {
          campaign = await ctx.apiFetch('meta-campaigns', {
            method: 'POST',
            body: buildBody(['messenger']),
            schema: createMetaCampaignResponseSchema,
          });
          destinations = ['messenger'];
          whatsappFallback = true;
        } catch (retryError) {
          return {
            data: {
              uiState: 'error',
              error:
                retryError instanceof Error
                  ? retryError.message
                  : 'Failed to create campaign.',
            },
          };
        }
      } else {
        return {
          data: {
            uiState: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Failed to create campaign.',
          },
        };
      }
    }

    // 6. Build the human-friendly Created card. The API doesn't echo back
    // name/status/dailyBudget — we use the input values and hardcode status
    // to "paused" (the service always creates PAUSED).
    const budgetLine = formatBudget(dailyBudgetCents, currencySymbol);

    const fields: CreatedField[] = [
      { label: 'Name', value: input.name },
      { label: 'Daily budget', value: budgetLine },
    ];

    if (requestedFollowUpType === 'chatbot') {
      fields.push({
        label: 'How leads reach you',
        value: destinationFieldValue(destinations),
      });
    } else {
      fields.push({
        label: 'How leads reach you',
        value: followUpTypeLabels.lead_form,
      });
    }

    // The branch comes back from the API, so the card states what was actually
    // targeted rather than echoing what the caller asked for.
    if (campaign.location) {
      fields.push({
        label: 'Targeting',
        value: `Within ${targeting.distanceKm}km of ${campaign.location.label}`,
      });
    }

    fields.push({ label: 'Status', value: statusLabel('paused') });

    // Record the created campaign as an action intent so a repeat request in
    // the next few days resolves to THIS campaign instead of spawning another
    // (Phase 4 #79 #151). Best-effort — never let a logging write fail the
    // create the owner already got.
    try {
      await recordActionIntent(db, {
        organizationId: ctx.organizationId,
        conversationId: ctx.conversationId,
        action: 'create_campaign',
        key: `${input.name} ${dedupeObjective}`,
        resourceId: campaign.metaCampaignId,
        displayName: input.name,
        metadata: { objective: dedupeObjective },
      });
    } catch {
      // Non-fatal.
    }

    // No action buttons: the Created card surfaces the resolved values only.
    // Per-user preference (2026-05-17) — follow-up actions (add an ad, change
    // budget, promote to default) belong in chat as the next user prompt, not
    // as inline buttons on every successful creation.
    return {
      data: {
        uiState: 'created',
        title: `Campaign created: ${input.name}`,
        fields,
        actions: [],
        campaignId: campaign.metaCampaignId,
        name: input.name,
        status: 'paused',
        dailyBudget: dailyBudgetCents,
        ...(whatsappFallback
          ? {
              whatsappFallbackNote:
                "WhatsApp isn't linked to your Facebook Page yet, so I set this up with Messenger. To use WhatsApp, link your Page to a WhatsApp Business Account in Settings → Integrations, then we can switch it.",
            }
          : {}),
      },
    };
  },
});
