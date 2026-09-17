import type { AssistantRecommendationKind } from '@borradh-workspace/database';

/**
 * Prompt templates per recommendation kind. The LLM returns JSON matching
 * `generatedPayloadSchema`. The regex validator runs after to block any
 * outcome claims, percentages, POM brand names, or banned phrases.
 *
 * Only `prompt_create_first_ad` ships in v2. Other `prompt_*` kinds get
 * their templates when the other dev wires their triggers in v2.1/v2.2.
 */
export const SYSTEM_PROMPT = `You are Claire, a warm but direct Irish marketing assistant helping aesthetic clinic owners in the UK and Ireland.

You produce short, specific, compliance-safe suggestions for in-app recommendations. Your output will be shown on a toast card next to a "Create" button.

COMPLIANCE RULES — HARD. Never violate:
- No percentage claims (e.g. "30% off", "up to 60% reduction").
- No outcome claims with numbers (e.g. "3x smoother", "5 sessions for full results").
- No absolute guarantees ("guaranteed", "proven", "cure", "best", "most effective", "miracle").
- Never name a prescription-only medicine brand (Botox, Aqualyx, Lemon Bottle, Kybella, Juvederm, Azzalure, Dysport, Bocouture).
- Never mention a specific outcome, timeline, or medical effect numerically.

TONE: Irish, warm, name-first, concise. No emojis. No "just" as a softener. Tell the clinic what to do.

RESPONSE FORMAT: JSON only. Match this shape exactly:
{
  "title": "≤ 200 chars — short, specific, the toast headline",
  "body": "≤ 500 chars — 1-2 sentences explaining what to do and why",
  "suggestedCampaignName": "optional, ≤ 100 chars — catchy name for the campaign, no claims",
  "suggestedService": "optional, ≤ 100 chars — service name from their menu",
  "suggestedPrice": "optional, ≤ 50 chars — a reasonable intro price",
  "suggestedPainPoint": "optional, ≤ 200 chars — one pain-point question",
  "campaignAngle": "optional, ≤ 200 chars — brief framing of the angle"
}`;

export function buildUserPrompt(
  kind: AssistantRecommendationKind,
  context: {
    clinicName?: string;
    services?: Array<{ name: string }>;
    hasAnyCampaign: boolean;
    /**
     * Optional structured data the trigger has computed (campaign name,
     * current vs prior CPL, frequency, lead counts). Only the Phase 4 perf
     * triggers (W-C16-perf-triggers) use this; existing `prompt_*` cases
     * ignore it.
     *
     * Triggers MUST NOT expect the LLM to echo raw percentages or numeric
     * outcome claims into the recommendation copy — the d2b validator
     * rejects bare percentages. The structured numbers belong on the
     * recommendation's `metadata` (so `/assistant?prefill=…` can read them);
     * the LLM copy stays generic ("Your CPL is climbing"). The fields below
     * give the LLM tonal context (which campaign, how many leads) so the
     * sentence feels grounded without quoting numbers.
     */
    triggerContext?: Record<string, unknown>;
  }
): string {
  const serviceLines =
    context.services
      ?.slice(0, 15)
      .map((s) => `- ${s.name}`)
      .join('\n') ?? 'No services imported yet.';

  switch (kind) {
    case 'prompt_create_first_ad':
      return `Clinic: ${context.clinicName ?? 'the clinic'}.
Services:
${serviceLines}

This clinic has ${context.hasAnyCampaign ? 'existing campaigns' : 'no active ad campaigns yet'}. Suggest their first ad.

Pick ONE service from the menu that:
- Has a short rebooking cycle (people come back for it),
- Is a low-barrier entry (first-visit offer makes sense),
- Is not a POM.

Suggest a campaign name, service, a reasonable intro price the clinic owner can edit, and one pain-point question. No outcome claims, no percentages, no POM brands.`;

    case 'prompt_record_first_video':
      return `Clinic: ${context.clinicName ?? 'the clinic'}.
Services:
${serviceLines}

This clinic has no videos yet. Suggest their first video to help showcase a treatment and attract new clients.

Pick ONE service from the menu that:
- Has strong visual results (before/after or procedure footage works well),
- Is a popular or signature treatment,
- Is not a POM.

Return:
- \`title\`: short toast headline, e.g. "Ready to create your first video"
- \`body\`: 1-2 sentences encouraging them to make the video
- \`suggestedService\`: the service name
- \`suggestedPrice\`: a reasonable price point to reference

No outcome claims, no percentages, no POM brands.`;

    case 'prompt_create_first_offer':
      return `Clinic: ${context.clinicName ?? 'the clinic'}.
Services:
${serviceLines}

This clinic has no offers set up yet. Suggest their first offer to help fill quiet slots or attract new clients.

Pick ONE service from the menu that:
- Is a popular entry-level treatment,
- Would benefit from a limited-time or bundle offer,
- Is not a POM.

Return:
- \`title\`: short toast headline, e.g. "Ready to create your first offer"
- \`body\`: 1-2 sentences encouraging them to set up the offer
- \`suggestedCampaignName\`: the name for the offer (use this field), e.g. "New Client Welcome"
- \`suggestedService\`: the service name
- \`suggestedPrice\`: a reasonable intro price

No outcome claims, no percentages, no POM brands.`;

    case 'prompt_create_first_post':
      return `Clinic: ${context.clinicName ?? 'the clinic'}.
Services:
${serviceLines}

This clinic has no social posts scheduled yet. Suggest their first social media post to showcase their work and attract new clients.

Pick ONE service from the menu that:
- Has strong visual appeal (before/after, treatment footage, or a popular treatment),
- Is a signature or popular offering,
- Is not a POM.

Return:
- \`title\`: short toast headline, e.g. "Ready to schedule your first post"
- \`body\`: 1-2 sentences encouraging them to post consistently
- \`suggestedService\`: the service name to feature in the post

No outcome claims, no percentages, no POM brands.`;

    case 'no_show_surge':
      return `Clinic: ${context.clinicName ?? 'the clinic'}.

The no-show rate at this clinic has climbed week-over-week. Write a short toast nudging the owner to look at recent no-shows and decide what to do — for example, tightening reminders, reviewing deposit policy, or following up with the clients who didn't turn up.

Return:
- \`title\`: short headline, e.g. "No-show rate is up this week"
- \`body\`: 1-2 sentences. Tell them what's worth checking. Don't promise a fix.

No outcome claims, no percentages, no POM brands. Don't say "guaranteed" or "proven".`;

    case 'offer_expiring_soon':
      return `Clinic: ${context.clinicName ?? 'the clinic'}.
Services:
${serviceLines}

This clinic has one or more active offers expiring within the next 7 days. Write a short toast nudging the owner to decide whether to extend, replace, or let them lapse.

Return:
- \`title\`: short headline, e.g. "Offers expiring this week"
- \`body\`: 1-2 sentences. Suggest they decide before the deadline; don't push extension as the obvious answer.

No outcome claims, no percentages, no POM brands.`;

    case 'cpl_spike': {
      const campaignName =
        typeof context.triggerContext?.campaignName === 'string'
          ? context.triggerContext.campaignName
          : null;
      const subject = campaignName
        ? `the "${campaignName}" campaign`
        : 'one of their active campaigns';
      return `Clinic: ${context.clinicName ?? 'the clinic'}.

Cost per lead has climbed sharply week-over-week on ${subject}. Write a short toast nudging the owner to open Claire and look at what's driving the increase — frequency, audience fatigue, creative going stale, or a budget change.

Return:
- \`title\`: short headline, e.g. "Your CPL is climbing on ${campaignName ? campaignName : 'a campaign'}" (keep it under 80 chars)
- \`body\`: 1-2 sentences. Tell them it's worth a look; don't tell them what to do — Claire will diagnose once they open the chat. Don't quote a percentage or a number; just say "sharply" or "noticeably".

No outcome claims, no percentages, no POM brands. Don't say "guaranteed" or "proven".`;
    }

    case 'creative_burnout': {
      const campaignName =
        typeof context.triggerContext?.campaignName === 'string'
          ? context.triggerContext.campaignName
          : null;
      const subject = campaignName
        ? `the "${campaignName}" campaign`
        : 'one of their active campaigns';
      return `Clinic: ${context.clinicName ?? 'the clinic'}.

Frequency has crept above the safe threshold on ${subject} — the same people are seeing the same creative too often, which usually means CPMs climb and CTR drops. Write a short toast nudging the owner to swap in fresh creative.

Return:
- \`title\`: short headline, e.g. "Time to refresh your ad creative"
- \`body\`: 1-2 sentences. Tell them the creative is wearing out and a new video or image is the cleanest fix. Don't quote a frequency number; just say "the audience is seeing it too often".

No outcome claims, no percentages, no POM brands. Don't say "guaranteed" or "proven".`;
    }

    case 'lead_volume_drop': {
      const priorWeekTotal =
        typeof context.triggerContext?.priorWeekTotal === 'number'
          ? context.triggerContext.priorWeekTotal
          : null;
      const thisWeekTotal =
        typeof context.triggerContext?.thisWeekTotal === 'number'
          ? context.triggerContext.thisWeekTotal
          : null;
      const sizeHint =
        priorWeekTotal !== null && thisWeekTotal !== null
          ? `Prior week saw ${priorWeekTotal} leads; this week is at ${thisWeekTotal} so far.`
          : '';
      return `Clinic: ${context.clinicName ?? 'the clinic'}.

Lead volume is down meaningfully this week vs. last. ${sizeHint} Write a short toast nudging the owner to open Claire and check what's slowed: ad spend changes, paused campaigns, audience fatigue, or seasonal dip.

Return:
- \`title\`: short headline, e.g. "Lead volume dropped this week"
- \`body\`: 1-2 sentences. Tell them it's worth a look; don't blame any one cause. Don't quote a percentage or repeat the lead counts; just say "down meaningfully" or "slowed noticeably".

No outcome claims, no percentages, no POM brands. Don't say "guaranteed" or "proven".`;
    }

    default:
      return `Generate title and body for recommendation kind "${kind}" for clinic ${context.clinicName ?? 'the clinic'}. Be concise, compliance-safe, and specific.`;
  }
}
