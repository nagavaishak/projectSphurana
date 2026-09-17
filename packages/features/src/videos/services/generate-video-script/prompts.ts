import { businessTypeLabels } from '@borradh-workspace/labels';
import {
  type OrgContext,
  buildOrgContextBlock,
} from '../../../shared/org-context.js';
import type { TemplateVariation } from '../../templates/index.js';

/**
 * Build system + user messages for generating a personalized video script
 * from a template variation and the user's business context.
 */
export function buildVideoScriptPrompt(
  orgContext: OrgContext,
  variation: TemplateVariation,
  narrationMode?: 'recorded' | 'ai_voiceover' | 'text_only',
  refinement?: { instruction?: string; priorScriptText?: string }
): { systemMessage: string; userMessage: string } {
  const businessType =
    businessTypeLabels[orgContext.businessType] || orgContext.businessType;

  const isTestimonial = variation.id.startsWith('testimonial');
  const isTextOnly = (narrationMode ?? variation.narrationMode) === 'text_only';

  // Determine the effective narration mode: explicit param > variation default > 'recorded'
  const effectiveMode = narrationMode ?? variation.narrationMode ?? 'recorded';

  // Voice/perspective rules based on narration mode
  let narrationRules = '';
  if (effectiveMode === 'ai_voiceover') {
    narrationRules = `- CRITICAL — NARRATION STYLE: This script will be read by an AI voiceover narrator, NOT by the business owner. The narrator speaks on behalf of the business using "we" and "our" (e.g. "our clinic", "we help clients", "our team").\n- NEVER use first-person singular: "I", "I'm", "me", "my". NEVER introduce yourself as the owner (e.g. "Hi, I'm the owner of..."). NEVER start with greetings like "Hi" or "Hello" — jump straight into the information.\n- Even if the template below uses "I" or speaks as the owner, you MUST convert it to collective "we/our" voice. For example, "I help clients with X" becomes "We help clients with X".`;
  } else if (effectiveMode === 'text_only') {
    narrationRules = `- CRITICAL — TEXT-ON-SCREEN FORMAT: This is NOT a spoken script. Each line will appear as a SEPARATE text frame on screen, one at a time over background footage. You MUST output each point on its own line separated by \\n. Do NOT merge lines into flowing sentences or paragraphs. Keep each line short and punchy (under 10 words). Write in third person — no "I", "we", or "our". The template shows exactly how many lines and what kind of content each line should have — match that structure exactly.`;
  } else if (effectiveMode === 'recorded') {
    narrationRules =
      '- This script will be read on camera by the business owner. Write in FIRST PERSON — use "I", "we", "our". Speak directly to the viewer as the business owner.';
  }

  const systemMessage = `You are an expert short-form video scriptwriter for a ${businessType}.
Your job is to take a script template with placeholder variables and rewrite it into a complete, ready-to-read script personalized to this business.

${buildOrgContextBlock(orgContext)}

Rules:
${narrationRules}
- Replace placeholder variables (text in [UPPER CASE BRACKETS] like [SERVICE NAME], [PATIENT NAME], [PROBLEM], etc.) with real, specific content based on the business context above.
- The final script must contain no UPPER CASE placeholder variables — those should all be filled in.
- IMPORTANT: Lines that start and end with square brackets and contain lowercase instructions (e.g. "[Client responds — talks about their problem]", "[Client responds]") are PAUSE MARKERS, not placeholders. You MUST keep these lines EXACTLY as they appear in the template. Do NOT replace, remove, or rewrite them.
- Use the template as a guide for topic and flow, but adapt the wording to fit the narration style above.
- Write naturally and conversationally. Match the brand voice described above.
- Reference actual services offered by the business where appropriate.
- Use the credibility line naturally if one is provided.
- If the template references pain points, expected results, processes, or target areas, use the service details above if available. If no service details are provided, generate realistic and appropriate ones based on the business type and services offered.
${isTestimonial ? '- This is a testimonial interview script. Keep ALL the clinic owner lines AND all [Client responds...] pause markers. The script should be roughly the same length as the template — do NOT shorten it.' : isTextOnly ? '- Match the template structure exactly — output the same number of lines. Each line is a separate on-screen frame, so keep them concise and impactful.' : '- CRITICAL: Keep the script VERY short — aim for 3-4 sentences max, roughly 15-20 seconds when spoken aloud. The template is just a guide for structure; your output should be HALF the length of the template or shorter.'}
- Do NOT add hashtags, emojis, or social media formatting.
- CRITICAL: Preserve paragraph breaks. Use blank lines (double newlines) between paragraphs exactly as they appear in the template.

Respond with valid JSON only.`;

  const narrationUserHint =
    effectiveMode === 'ai_voiceover'
      ? '\n\nIMPORTANT: Write this as an AI voiceover speaking on behalf of the business. Use "we" and "our" (e.g. "our clinic", "we specialise in"). Do NOT use "I", "me", or "my". Do NOT introduce yourself as the owner. Do NOT start with "Hi" or "Hello". The template may use first-person singular — convert it to collective "we/our" voice.'
      : effectiveMode === 'text_only'
        ? '\n\nIMPORTANT: Each line in the output will be displayed as a SEPARATE text frame on screen. Output each point on its own line separated by \\n — do NOT combine them into sentences or paragraphs. Match the number of lines in the template.'
        : effectiveMode === 'recorded'
          ? '\n\nWrite this in first person as the business owner speaking to camera.'
          : '';

  const userMessage = `Here is the script template to personalize:

Template name: "${variation.variationName}"
Template description: "${variation.description}"

Script template:
"""
${variation.scriptTemplate}
"""

Rewrite this into a complete, personalized script for the business described above. Replace all placeholders with real content.${narrationUserHint}

Return JSON in this exact format:
{
  "scriptText": "${isTextOnly ? 'Line 1\\nLine 2\\nLine 3\\n...' : 'The complete personalized script ready to read aloud'}"
}`;

  // Refinement: apply the user's change to the script they already saw, when
  // we have it; otherwise treat the instruction as upfront guidance.
  const instruction = refinement?.instruction?.trim();
  if (instruction) {
    const refinementBlock = refinement?.priorScriptText
      ? `\n\nThe user reviewed this previous script:\n"""\n${refinement.priorScriptText}\n"""\nApply ONLY this change and keep everything else as close as possible: ${instruction}`
      : `\n\nUser instruction (steer the script accordingly): ${instruction}`;
    return {
      systemMessage,
      userMessage: userMessage + refinementBlock,
    };
  }

  return { systemMessage, userMessage };
}
