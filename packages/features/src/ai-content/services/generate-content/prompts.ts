import { businessTypeLabels } from '@borradh-workspace/labels';
import { currencyForCountry } from '../../../shared/currency-for-country.js';
import {
  type OrgContext,
  buildOrgContextBlock,
} from '../../../shared/org-context.js';

export function buildAdPrompt(
  orgContext: OrgContext,
  mediaContext: string,
  platform?: string,
  serviceNames?: string[],
  includeOffer = false
): { systemMessage: string; userMessage: string } {
  // Display offer prices in the org's currency (from its location country) so
  // US/UK orgs don't get a euro symbol baked into the caption.
  const { symbol } = currencyForCountry(orgContext.country);

  const serviceInstruction =
    serviceNames && serviceNames.length > 0
      ? `\n- The ad is specifically for the following service(s): ${serviceNames.join(', ')}. The caption MUST be relevant to this specific service.`
      : '';

  const angleRules = includeOffer
    ? `
OFFER ANGLE (explicitly requested by the caller):
- Use one specific pain point, one service named by what it solves, one offer,
  and end with the FIXED CTA "Message us to book".
- If a price is present, use "Just ${symbol}X" or "Was ${symbol}X → now ${symbol}X".
`
    : `
VALUE ANGLE (the default):
- Use one specific pain point or question, one service named by what it solves,
  one useful insight/process detail/believable benefit, and a soft CTA.
- Do not invent a price, discount, "Was … now …" framing, or intro offer.
- Only use an offer if the caller explicitly requests it.
`;

  const systemMessage = `You are an expert social media ad copywriter for a ${businessTypeLabels[orgContext.businessType] || orgContext.businessType}.
Your job is to write a single, focused ad. Do not add claims or pricing that are
not present in the media context.

${buildOrgContextBlock(orgContext)}

${angleRules}

HARD RULES (a violation makes the ad unusable):
- NEVER use a percentage discount of any kind. No "%", no "20% off", no "save 50%".
- NEVER fabricate or quantify results (no "60% reduction", "3x improvement", "guaranteed", "proven", "permanent", "best", "miracle").
- Keep the whole ad SHORT — it must fit on one phone screen at a glance. Be concise.
- Exactly one pain point and one service. No stacking.

Field mapping:
- headline: max 80 characters. The ONE pain point (step 1), phrased to grab attention.
- primaryText: max 500 characters, but keep it short (1-3 short sentences). Cover the service and the requested value/offer angle, then end with a clear CTA.
- description: max 30 characters, supporting detail (no price, no percentage).
- callToAction: must be the exact value BOOK_NOW (this is the Meta button; the literal "Message us to book" line lives in primaryText).
- Match the brand voice described above${serviceInstruction}
${platform ? `- Optimize for ${platform}` : ''}

Respond with valid JSON only.`;

  const ctaInstruction = includeOffer
    ? 'one offer, ending with "Message us to book"'
    : 'the requested value angle and a clear, non-pushy CTA';
  const userMessage = `Based on the following media content, generate ONE ad that follows the requested angle (${ctaInstruction}):

Media context: ${mediaContext}

Return JSON in this exact format:
{
  "headline": "string (max 80 chars — the single specific pain point)",
  "primaryText": "string (short; one service by what it solves, the requested value/offer angle, and a clear CTA)",
  "description": "string (max 30 chars)",
  "callToAction": "BOOK_NOW"
}`;

  return { systemMessage, userMessage };
}

export function buildSocialPostPrompt(
  orgContext: OrgContext,
  mediaContext: string,
  platform?: string
): { systemMessage: string; userMessage: string } {
  const systemMessage = `You are an expert social media content creator for a ${businessTypeLabels[orgContext.businessType] || orgContext.businessType}.
Your job is to write engaging social media captions that drive engagement.

${buildOrgContextBlock(orgContext)}

Rules:
- caption: 2-4 sentences, engaging and authentic
- hashtags: 5-10 relevant hashtags without the # symbol
- Write naturally, match the brand voice above
- Include a soft call-to-action in the caption where appropriate
- Don't use excessive emojis (1-2 max if relevant)
${platform ? `- Optimize for ${platform}` : ''}

Respond with valid JSON only.`;

  const userMessage = `Based on the following media content, generate a social media post:

Media context: ${mediaContext}

Return JSON in this exact format:
{
  "caption": "string (2-4 sentences)",
  "hashtags": ["hashtag1", "hashtag2", "..."]
}`;

  return { systemMessage, userMessage };
}
