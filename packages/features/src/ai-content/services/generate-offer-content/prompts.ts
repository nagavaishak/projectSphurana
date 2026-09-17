import type { OrgContext } from '../../../shared/org-context.js';

/**
 * Build the system prompt for generating offer content.
 */
export function buildOfferContentSystemPrompt(): string {
  return `You are a marketing copywriter for aesthetic clinics and beauty businesses.
Your job is to generate compelling offer card content for square-format video ads.

Rules:
- Headline: A short benefit statement, max 8 words. It will be displayed in ALL CAPS.
  Good examples: "ACHIEVE FIRMER SMOOTHER YOUTHFUL LOOKING SKIN", "REVEAL YOUR NATURAL RADIANCE TODAY"
  Bad examples: "50% OFF BOTOX" (too salesy), "We offer the best treatments" (not benefit-focused)
- Bullet points: 3-4 specific benefits or outcomes. Each should be concise (3-8 words).
  Good: "Non-Invasive Treatment", "Safe For All Skin Types", "Results In Just 3 Sessions"
  Bad: "Our treatment is completely non-invasive and safe" (too long)

Focus on the treatment's benefits and outcomes, not the price or discount.
Use the service details (pain points, expected results, process) to generate specific, relevant content.

Return valid JSON only.`;
}

/**
 * Build the user prompt with org and service context.
 * When no specific service is provided, uses all org services for broader context.
 */
export function buildOfferContentUserPrompt(
  orgContext: OrgContext,
  serviceName: string | undefined,
  serviceDetail: OrgContext['serviceDetails'][number] | undefined,
  headline?: string
): string {
  const parts: string[] = [];

  parts.push(`Business type: ${orgContext.businessType}`);

  if (serviceName) {
    parts.push(`Service: ${serviceName}`);
  }

  if (serviceDetail?.painPoints?.length) {
    parts.push(
      `Pain points this solves: ${serviceDetail.painPoints.join(', ')}`
    );
  }

  if (serviceDetail?.expectedResults?.length) {
    parts.push(`Expected results: ${serviceDetail.expectedResults.join(', ')}`);
  }

  if (serviceDetail?.processDescription) {
    parts.push(`Process: ${serviceDetail.processDescription}`);
  }

  if (serviceDetail?.targetArea) {
    parts.push(`Target area: ${serviceDetail.targetArea}`);
  }

  // When no specific service, include all org services for broader context
  if (!serviceName && orgContext.services.length > 0) {
    parts.push(`Services offered: ${orgContext.services.join(', ')}`);
    const detailed = orgContext.serviceDetails.filter(
      (s) => s.painPoints?.length || s.expectedResults?.length
    );
    if (detailed.length > 0) {
      for (const s of detailed) {
        if (s.painPoints?.length) {
          parts.push(`${s.name} solves: ${s.painPoints.join(', ')}`);
        }
        if (s.expectedResults?.length) {
          parts.push(`${s.name} results: ${s.expectedResults.join(', ')}`);
        }
      }
    }
  }

  if (orgContext.brandVoice?.length) {
    parts.push(`Brand voice: ${orgContext.brandVoice.join(', ')}`);
  }

  if (headline) {
    parts.push(`Offer headline: ${headline}`);
    parts.push(
      'Generate bullet points that complement and support this headline.'
    );
  }

  parts.push(
    '\nGenerate a JSON object with:\n' +
      '- "headline": string (max 8 words, benefit-focused, suitable for ALL CAPS display)\n' +
      '- "bulletPoints": string[] (3-4 items, each 3-8 words, specific benefits/outcomes)'
  );

  return parts.join('\n');
}
