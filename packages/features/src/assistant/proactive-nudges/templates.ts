import type {
  CreateWhatsAppTemplateInput,
  WhatsAppCloudService,
  WhatsAppTemplate,
} from '@borradh-workspace/integrations/whatsapp';

/**
 * Proactive-nudge WhatsApp template catalogue (WS-11, plan §2 P5 / §4 WS-11).
 *
 * Outside the 24-hour customer-service window WhatsApp only allows PRE-APPROVED
 * templates. A proactive Claire nudge ("your campaign got 5 leads today") must
 * open the conversation with one of these approved templates; once the owner
 * replies, the 24h window opens and the normal inbound Claire path (WS-10)
 * continues free-form.
 *
 * Each template body uses positional `{{n}}` placeholders. The numbered example
 * values are required by Meta's review process. Templates are MARKETING /
 * UTILITY category and must be APPROVED by the operator in the Meta UI before
 * `CLAIRE_WHATSAPP_PROACTIVE_ENABLED` can be flipped on (plan §0.C —
 * BLOCKED-ON-OPERATOR for the approval step; the submit code below is complete).
 */

export type ClaireNudgeTemplateName =
  | 'daily_lead_recap'
  | 'campaign_milestone'
  | 'no_leads_check_in';

export interface ClaireNudgeTemplateDef {
  /** Template name (must match `name` submitted to / approved by Meta). */
  name: ClaireNudgeTemplateName;
  /** The full create payload submitted via `WhatsAppCloudService.createTemplate`. */
  create: CreateWhatsAppTemplateInput;
  /** Ordered placeholder keys → the order parameters are passed at send time. */
  paramOrder: string[];
  /** Example values for the placeholders (Meta review aid + send-time docs). */
  example: string[];
}

const LANGUAGE = 'en';

/**
 * THE catalogue. Bodies are deliberately short, mobile-first, and end with an
 * open invitation so the owner's reply lands back in the free-form Claire path.
 */
export const CLAIRE_NUDGE_TEMPLATES: Record<
  ClaireNudgeTemplateName,
  ClaireNudgeTemplateDef
> = {
  daily_lead_recap: {
    name: 'daily_lead_recap',
    paramOrder: ['leadCount'],
    example: ['5'],
    create: {
      name: 'daily_lead_recap',
      category: 'MARKETING',
      language: LANGUAGE,
      body: 'You got {{1}} new high-intent leads today. Reply here and I can break them down or help you follow up.',
    },
  },
  campaign_milestone: {
    name: 'campaign_milestone',
    paramOrder: ['campaignName', 'milestone'],
    example: ['Spring Facials', '50 leads'],
    create: {
      name: 'campaign_milestone',
      category: 'MARKETING',
      language: LANGUAGE,
      body: 'Your campaign "{{1}}" just hit {{2}}. Reply here if you want to see what is working or scale it up.',
    },
  },
  no_leads_check_in: {
    name: 'no_leads_check_in',
    paramOrder: ['campaignName'],
    example: ['Spring Facials'],
    create: {
      name: 'no_leads_check_in',
      category: 'MARKETING',
      language: LANGUAGE,
      body: 'Your campaign "{{1}}" has been quiet for a few days. Reply here and I can diagnose it and suggest what to change.',
    },
  },
};

export const CLAIRE_NUDGE_TEMPLATE_LANGUAGE = LANGUAGE;

export interface SubmitClaireNudgeTemplatesResult {
  /** Templates that already existed (any status) and were skipped. */
  skipped: ClaireNudgeTemplateName[];
  /** Templates submitted to Meta this run (status PENDING until approved). */
  submitted: Array<{
    name: ClaireNudgeTemplateName;
    id: string;
    status: string;
  }>;
}

/**
 * Idempotently submit the nudge templates to the dedicated Claire WABA.
 *
 * Lists existing templates first and skips any already present (by name), so a
 * re-run after a partial submit only creates the missing ones. After submission
 * the templates are PENDING — the operator must APPROVE them in the Meta UI
 * (BLOCKED-ON-OPERATOR, plan §0.C). Pure orchestration over the injected
 * service so it is unit-testable with a mocked WABA.
 */
export async function submitClaireNudgeTemplates(
  service: Pick<WhatsAppCloudService, 'listTemplates' | 'createTemplate'>,
  wabaId: string
): Promise<SubmitClaireNudgeTemplatesResult> {
  const existing: WhatsAppTemplate[] = await service.listTemplates(wabaId);
  const existingNames = new Set(existing.map((t) => t.name));

  const skipped: ClaireNudgeTemplateName[] = [];
  const submitted: SubmitClaireNudgeTemplatesResult['submitted'] = [];

  for (const def of Object.values(CLAIRE_NUDGE_TEMPLATES)) {
    if (existingNames.has(def.name)) {
      skipped.push(def.name);
      continue;
    }
    const created = await service.createTemplate(wabaId, def.create);
    submitted.push({ name: def.name, id: created.id, status: created.status });
  }

  return { skipped, submitted };
}
