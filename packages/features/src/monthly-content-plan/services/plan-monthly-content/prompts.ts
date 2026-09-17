import type { OrgContext } from '../../../shared/org-context.js';

/**
 * Candidate service descriptor handed to the model. The planner builds
 * this from the org's active service catalog; the model must pick
 * `targetServiceId` from this list (validated post-response).
 */
export interface PromptServiceCandidate {
  id: string;
  name: string;
  painPoints: string[] | null;
  expectedResults: string[] | null;
  processDescription: string | null;
  targetArea: string | null;
  /**
   * Whether this service has uploaded media (photos / video screenshots) that
   * a graphic can use. Graphic items (carousel/single) MUST target a service
   * with `hasMedia: true` — we never AI-generate images for the batch.
   */
  hasMedia: boolean;
  /**
   * Whether this service has its OWN uploaded video clips. When stock footage
   * is allowed, a service without uploaded clips can still back a video via
   * curated stock b-roll.
   */
  hasVideoFootage: boolean;
}

export interface BuildMonthlyPlanPromptInput {
  orgContext: OrgContext;
  serviceCandidates: PromptServiceCandidate[];
  recentTopics: string[];
  periodMonth: string;
  videoCount: number;
  carouselCount: number;
  singleCount: number;
  allowStockFootage?: boolean;
}

/**
 * Build the system + user message pair for the monthly topic planner.
 *
 * The instructions emphasise:
 *   - Pick services from the supplied catalog (no invented IDs).
 *   - Spread coverage — favour different services rather than four
 *     videos about the same treatment.
 *   - Avoid topics that overlap with the recent-topics list.
 *   - Match modality to topic: video for narrative or demo-style topics,
 *     carousel for educational/step-by-step, single for punchy stat /
 *     myth / quote-style topics.
 *   - Output must be JSON matching the supplied schema.
 */
export const buildMonthlyPlanPrompt = ({
  orgContext,
  serviceCandidates,
  recentTopics,
  periodMonth,
  videoCount,
  carouselCount,
  singleCount,
  allowStockFootage = true,
}: BuildMonthlyPlanPromptInput): {
  systemMessage: string;
  userMessage: string;
} => {
  const totalCount = videoCount + carouselCount + singleCount;

  const servicesBlock = serviceCandidates
    .map((s, idx) => {
      const mediaTag = s.hasMedia
        ? 'hasMedia=true (graphics OK)'
        : allowStockFootage
          ? 'hasMedia=false (graphics OK via stock/generated imagery)'
          : 'hasMedia=false (NO graphics)';
      const videoTag = s.hasVideoFootage
        ? 'hasVideoFootage=true (video OK)'
        : allowStockFootage
          ? 'hasVideoFootage=false (video OK via stock)'
          : 'hasVideoFootage=false (NO video)';
      const lines = [
        `${idx + 1}. id="${s.id}" — ${s.name} [${mediaTag}; ${videoTag}]`,
      ];
      if (s.painPoints && s.painPoints.length > 0) {
        lines.push(`   pain points: ${s.painPoints.join(', ')}`);
      }
      if (s.expectedResults && s.expectedResults.length > 0) {
        lines.push(`   results: ${s.expectedResults.join(', ')}`);
      }
      if (s.processDescription) {
        lines.push(`   process: ${s.processDescription}`);
      }
      if (s.targetArea) {
        lines.push(`   target area: ${s.targetArea}`);
      }
      return lines.join('\n');
    })
    .join('\n\n');

  // Explicit allow-list of services that can back a video. When only a few of
  // many services have footage, handing the model a short whitelist is far more
  // reliable than asking it to filter the full tagged catalog above.
  const videoEligible = serviceCandidates.filter(
    (s) => s.hasVideoFootage || allowStockFootage
  );
  const videoEligibleBlock =
    videoEligible.length > 0
      ? videoEligible.map((s) => `- id="${s.id}" — ${s.name}`).join('\n')
      : '(none — do NOT emit any video items)';

  // THE FOURTH COPY of the graphics-eligibility rule. `canPlanGraphics` settled
  // it for the two COUNT gates and `validatePlan` settled it per item — but the
  // PROMPT still told the model "a service with no uploaded media cannot have a
  // graphic". So an org with zero media-backed services was asked for six
  // graphics and simultaneously forbidden from placing any: the model split the
  // difference and returned three, nothing was dropped, nothing was logged, and
  // the batch came out 9 of 12.
  const graphicEligible = serviceCandidates.filter(
    (s) => s.hasMedia || allowStockFootage
  );
  const graphicEligibleBlock =
    graphicEligible.length > 0
      ? graphicEligible.map((s) => `- id="${s.id}" — ${s.name}`).join('\n')
      : '(none — do NOT emit any carousel or single items)';

  const recentTopicsBlock =
    recentTopics.length > 0
      ? recentTopics.map((t, i) => `${i + 1}. ${t}`).join('\n')
      : '(none)';

  const brandVoiceBlock =
    orgContext.brandVoice.length > 0
      ? orgContext.brandVoice.join(', ')
      : '(not set)';

  const systemMessage = `You are a social media content planner for a beauty / wellness / aesthetics business. Your job is to plan one month of organic social content for a business. You will produce ${totalCount} content ideas split across three modalities:

- ${videoCount} short-form videos (15–60 seconds, vertical, narrative or demo style)
- ${carouselCount} multi-slide carousels (educational, step-by-step, or before/after)
- ${singleCount} single-image posts (punchy stat, quote, myth-bust, or strong visual hook)

CRITICAL RULES:
1. You MUST emit exactly ${videoCount} items with kind="video", ${carouselCount} with kind="carousel", and ${singleCount} with kind="single". The order in the items array does not matter.
2. targetServiceId MUST be one of the IDs listed in the SERVICES block — do not invent IDs and do not return service NAMES in that field.
2a. Graphic items (kind="carousel" or kind="single") MUST target a service listed in the GRAPHIC-ELIGIBLE SERVICES block below. ${
    allowStockFootage
      ? 'Services without uploaded media are allowed because curated stock stills or generated imagery back them.'
      : "These are the ONLY services with uploaded photos/clips. A graphic is built from the service's own media, so a service with none cannot have a graphic."
  } If that block says "(none)", emit ZERO carousel and ZERO single items.
2b. Video items (kind="video") MUST target a service listed in the VIDEO-ELIGIBLE SERVICES block below. ${
    allowStockFootage
      ? 'Services without uploaded video are allowed because curated stock footage may be AI-matched for them.'
      : "These are the ONLY services with their own uploaded video clips. An organic video uses ONLY that service's own footage and must never borrow another service's clips."
  } If that block says "(none)", emit ZERO video items.
3. Spread coverage: prefer different services across items. Repeating the same service for two items is allowed only when the topics are genuinely distinct.
4. AVOID the topics listed in the RECENT TOPICS block — pick fresh angles.
5. Match modality to topic:
   - Video → demos, transformations, behind-the-scenes, "what to expect", before/after reveals.
   - Carousel → step-by-step explanations, myth-busting lists, "5 things you didn't know", treatment comparisons.
   - Single → bold stats, single quotes, calendar reminders, "did you know" hooks, strong before/after stills.
6. topicSummary should be 1–2 sentences a copywriter can hand to the modality-specific planner.
7. rationale should briefly explain why this modality fits this service this month (1 sentence, internal-only).
8. Return ONLY valid JSON. No commentary, no markdown fences.`;

  const userMessage = `BUSINESS CONTEXT
================
Business type: ${orgContext.businessType}
Brand voice: ${brandVoiceBlock}
Target audience: ${orgContext.targetAudienceDescription ?? '(not set)'}
Tagline: ${orgContext.tagline ?? '(not set)'}
Credibility line: ${orgContext.credibilityLine ?? '(not set)'}

Period: ${periodMonth}

SERVICES (you MUST pick targetServiceId from this list)
=======================================================
${servicesBlock}

VIDEO-ELIGIBLE SERVICES (the ONLY services allowed for kind="video")
====================================================================
${videoEligibleBlock}

GRAPHIC-ELIGIBLE SERVICES (the ONLY services allowed for kind="carousel" or kind="single")
==========================================================================================
${graphicEligibleBlock}

RECENT TOPICS (avoid these — pick fresh angles)
================================================
${recentTopicsBlock}

OUTPUT FORMAT
=============
Return a JSON object with this exact shape:
{
  "items": [
    { "kind": "video" | "carousel" | "single", "targetServiceId": "<id>", "topicSummary": "<1-2 sentences>", "rationale": "<1 sentence>" },
    ...
  ]
}

Emit exactly ${videoCount} videos, ${carouselCount} carousels, and ${singleCount} singles (${totalCount} items total).`;

  return { systemMessage, userMessage };
};
