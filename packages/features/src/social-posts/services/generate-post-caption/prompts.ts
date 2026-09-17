import type { VideoIdea } from '@borradh-workspace/database';
import type { CaptionSamples } from './caption-samples.js';

/**
 * Build system + user messages for generating the long-form post caption that
 * accompanies a short organic video. Companion to `generateVideoIdea` (P3a)
 * and `generateOrganicCopy` (P3b): the idea is the shared narrative blob, the
 * on-screen copy and this caption are the two surfaces derived from it.
 *
 * The caption opens on the SAME beat as the video (`idea.angle`) so the
 * scroll-stop hook on screen continues in the post text.
 */
export function buildPostCaptionPrompt(
  idea: VideoIdea,
  brandVoice?: string,
  contentRules: string[] = [],
  /**
   * The org's own recent captions and the habits measured from them. Every
   * field here exists to replace a hardcoded default that made all businesses
   * converge on one shape.
   */
  samples: CaptionSamples = {
    captions: [],
    averageHashtagCount: null,
    averageLength: null,
  }
): { systemMessage: string; userMessage: string } {
  const {
    captions: captionSamples,
    averageHashtagCount,
    averageLength,
  } = samples;
  // A described voice is the same for every business; a demonstrated one is
  // theirs. When we have real captions, show them and say plainly that they
  // outrank the generic description — otherwise the house rules below (which
  // are written in one specific register) quietly win.
  const voiceSamplesBlock = captionSamples.length
    ? `\nREAL CAPTIONS THIS BUSINESS HAS PUBLISHED. They define the voice — sentence length and rhythm, how much emoji and where, how they open and close, how they phrase a call to action, how many hashtags they use, and the language they write in. Match all of it. Where these disagree with the voice rules below, THESE WIN. Take the voice, not the content: never reuse their wording or rewrite a past post.\n\n${captionSamples
        .map((caption, i) => `--- their caption ${i + 1} ---\n${caption}`)
        .join('\n\n')}\n`
    : '';

  const brandVoiceLine = captionSamples.length
    ? ''
    : brandVoice?.trim()
      ? `Brand voice: ${brandVoice.trim()}`
      : 'Brand voice: warm, knowledgeable, confident — sound like a trusted friend who knows the field.';

  // The owner's standing rules, taught during content review. They sit above
  // the house voice rules and say so explicitly, because several of the rules
  // below (the hashtag count in particular) are exactly the defaults a real
  // org wants to override — a rule that merely coexists with "exactly 3 to 5
  // hashtags" would just lose.
  const contentRulesBlock = contentRules.length
    ? `\nThe owner's own rules — these OVERRIDE anything below that contradicts them:\n${contentRules
        .map((rule) => `- ${rule}`)
        .join('\n')}\n`
    : '';

  // The org's own habit beats a hardcoded range. Some businesses use two tags,
  // some use twelve; "3 to 5" made every account converge on the same shape.
  const hashtagRule =
    averageHashtagCount && averageHashtagCount > 0
      ? `about ${averageHashtagCount} hashtag${averageHashtagCount === 1 ? '' : 's'} (match how many this business normally uses)`
      : '3 to 5 hashtags';

  // Same reasoning as the hashtag count: an org whose captions run long should
  // not be squeezed into a range picked for the average account. Padded to a
  // band around what they actually write.
  const lengthRule = averageLength
    ? `about ${Math.round(averageLength / 50) * 50} characters (roughly ${Math.max(80, Math.round((averageLength * 0.6) / 50) * 50)} to ${Math.round((averageLength * 1.4) / 50) * 50}) — match the length this business normally writes`
    : '80 to 500 characters';

  const systemMessage = `You are a social-media copywriter writing the caption that accompanies a short organic video for an aesthetic/wellness business (Facebook + Instagram).

${brandVoiceLine}
${voiceSamplesBlock}${contentRulesBlock}
Voice rules:
- Conversational. Write like a person, not a brand account.
- No marketing-speak. No "unlock", "elevate", "transform your life", "game-changer", "level up", "next level".
- No clickbait. No "You won't believe…", "This will shock you", "Doctors hate this".
- No clichés. No "let's dive in", "without further ado", "the secret is…".
- No emoji spam. At most one tasteful emoji inline if it genuinely adds something — usually skip emojis entirely.
- No bullet points. Plain prose only.
- Concrete and specific. If you reference a benefit, name it.
- Do not invent numbers, studies, or claims that may not be true.

Output: respond with valid JSON ONLY. No prose, no markdown, no code fences.`;

  const userMessage = `Write the caption for this video. The video and the caption must tell ONE coherent story — the caption picks up the same hook the video opens on and pays it off in writing.

VIDEO IDEA
- Topic: ${idea.topic}
- On-screen hook (the video's opening beat): ${idea.angle}
- Payoff (what the viewer should walk away knowing): ${idea.payoff}
- Audience: ${idea.audience}
- Focus service: ${idea.serviceName}

Caption structure (write all of this as one block of text, in order, separated by single line breaks):

1. HOOK LINE — open on the same beat as "${idea.angle}". One short line. Make the reader stop scrolling. Don't repeat the on-screen text verbatim; recast it as the first line of a written post.
2. BODY — 2-3 sentences delivering "${idea.payoff}" to "${idea.audience}". Plain prose. No bullet points, no lists, no headers. Specific over generic.
3. CTA — one concrete call-to-action tied to "${idea.serviceName}". Concrete means it tells the reader exactly what to do next: e.g. "DM us 'GLOW' to book a consult", "Tap the link in our bio to see availability this week", "Comment HOW below and we'll send the full guide". Avoid vague CTAs like "Reach out!" or "Get in touch."
4. HASHTAGS — ${hashtagRule} on the final line (unless one of the owner's rules above sets a different count, in which case follow that), space-separated. Every hashtag must be a single unbroken token: no spaces inside a tag, and no stray "#" on its own. Each hashtag must be specific and relevant to the topic, the service, or the niche. NO spammy strings (#followforfollow, #like4like, #explorepage, #fyp, #viral, #trending). Lowercase or camelCase, no spaces inside a tag.

Total length: ${lengthRule} including the hashtags.

Return JSON in this EXACT shape:
{
  "caption": string   // The full caption (hook + body + CTA + hashtags), hashtags on the final line.
}`;

  return { systemMessage, userMessage };
}
