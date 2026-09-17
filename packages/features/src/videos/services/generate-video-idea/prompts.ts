import { businessTypeLabels } from '@borradh-workspace/labels';
import {
  type OrgContext,
  buildOrgContextBlock,
} from '../../../shared/org-context.js';
import type { OrganicTemplateId } from './generate-video-idea.schema.js';

/**
 * Per-template format hints. The idea blob is template-agnostic in shape,
 * but the *kind* of topic that lands well differs across formats:
 *
 * - caption-tease: a single surprising claim where the payoff lives in the
 *   caption (the video literally nudges "Check the caption"). Great for
 *   counter-intuitive truths and myth-busts.
 * - ins-outs: a comparison topic — what's trending vs what's outdated for
 *   the niche this year. The idea should naturally split into "embrace"
 *   vs "drop" lists.
 * - question-cta: a tight hook *question* the viewer can't help but stay
 *   for. The answer goes in the caption, so the topic should be a real
 *   question people ask.
 * - improves: a benefit-driven angle — focus on the concrete things the
 *   service measurably improves (search-friendly terms).
 */
const TEMPLATE_FORMAT_HINTS: Record<OrganicTemplateId, string> = {
  'caption-tease': `Template format: "Caption Tease" — a single bold serif headline appears on screen with a tiny "Check the caption" cursive prompt below. The full payoff is delivered in the caption, NOT on screen.
- Topic should be a surprising, specific, or counter-intuitive claim about the focus service. Myth-busts, "most people don't know X", and concrete numbers work especially well.
- The angle is the on-screen hook (one bold claim, ~14 words max).
- The payoff is what the caption pays off — concrete, useful, and a satisfying answer to the curiosity the hook opened.`,
  'ins-outs': `Template format: "INS + OUTS" — a 2026 trends/anti-trends list. On screen: a title at top, then INS (5-7 short items) and OUTS (5-7 short items).
- Topic should be a comparison angle: what's IN vs what's OUT in this niche right now. Frame the topic around a tension ("the shift from X to Y", "what's replacing Z").
- The angle is the comparison itself ("the INS-and-OUTS shift for 2026 skincare").
- The payoff is the takeaway — what the viewer should embrace and what they should drop.`,
  'question-cta': `Template format: "Question + Read Caption" — a short question pinned to the top of the frame, a "Read caption ⬇" CTA at the bottom. The on-screen text is the hook; the answer lives entirely in the caption.
- Topic should be a real question people ask about the focus service. "How long…", "Is X worth it?", "Why does my…", "What happens if…".
- The angle is the question itself (4-9 words).
- The payoff is the real answer the caption delivers — concrete and immediately useful, not a generic "book a consult".`,
  improves: `Template format: "Service Improves" — opens on the service name in big caps, cuts through 2-4 "IMPROVES: <benefit>" beats, ends on a journey CTA.
- Topic should be a benefit-driven angle for the focus service — concrete, search-friendly improvements (e.g. "skin texture", "fine lines", "acne scars", not "wellness" or "beauty").
- The angle is the framing of what the service unlocks for the viewer.
- The payoff is the bundle of concrete improvements they walk away knowing about.`,
  'fade-benefits': `Template format: "Fade-In Benefits" — lines fade in one at a time, centered in a bold serif over calm footage. Opens on the service name, then 3-4 short felt-benefit lines.
- Topic should be a benefit-driven angle for the focus service — lead with the felt benefit ("calms active breakouts", "the reset your skin needs"), concrete and specific, not clinical jargon.
- The angle is the emotional throughline that ties the benefit lines together.
- The payoff is the bundle of concrete, felt benefits the viewer takes away.`,
  'aesthetic-line': `Template format: "Aesthetic Line" — a single understated lowercase serif line in the lower third, fading in over calm footage. A mood, NOT a hard sell. On screen it reads "this & <a short personal fantasy/feeling>".
- Topic should be the personal feeling or dream identity the focus service unlocks — relaxation/experience services → a calm personal mood; results-driven treatments → the dream outcome/identity. Never clinical features.
- The angle is that aspirational "this & my ..." feeling.
- The payoff is the emotional identity/outcome the caption leans into.`,
  'highlight-caption': `Template format: "Highlight Caption" — short lines reveal one at a time as white text on solid brand-colour highlight blocks over a procedure b-roll. A punchy hook line, then 3-5 short caption statements that build a story. The dominant, high-retention reel caption format. Confident and relatable; every line ≤7 words so it fits one highlight block.`,
  'curiosity-hook': `Template format: "Curiosity Hook" — a bold, surprising CLAIM (not a question) pinned at the top of the frame with a short "watch till the end" nudge at the bottom, over procedure footage. A curiosity gap that makes viewers keep watching to find out why. The payoff lives in the video/caption, not the hook.`,
  'step-timer': `Template format: "Step + Timer" — a bold title, then a numbered list of 3-5 timed steps (each step names an action and its duration, e.g. "Cleanse — 60 sec"), revealing one per clip over darkened footage. Save-worthy routine/protocol content.`,
  'myth-fact': `Template format: "Myth → Fact" — a confidently wrong belief on a card flips to the correction (red MYTH pill → green FACT pill). Debunk beliefs the audience actually holds about the service.`,
  versus: `Template format: "X vs Y" — the focus treatment compared attribute-by-attribute against its most-compared alternative, ending on an it-depends verdict (never a winner).`,
  'price-reveal': `Template format: "Price Reveal" — the treatment's real cost broken into receipt line-items that build up, total revealed last. Transparency content.`,
  'client-question': `Template format: "Client Question" — a real-sounding client DM pinned in a reply bubble, answered beat by beat over footage.`,
  'come-with-me': `Template format: "Come With Me" — a calm first-person mini-vlog of the visit experience, script title + lowercase diary captions.`,
  poll: `Template format: "Engagement Poll" — an A/B question over footage voted with native actions: like the post for option one, comment for option two (share for an optional third). Options must be genuinely debated by the audience; results show natively on the post.`,
  'time-progress': `Template format: "Time-lapse Progress" — a big timestamp progression (e.g. "Day 1 → Day 30" or "0h → 4h") held over footage that changes from before to after, with a short caption naming the visible change. Lets viewers watch results happen over time.`,
  'numbered-list': `Template format: "Numbered List" — a bold uppercase title at the top, then a 3-6 item numbered list (number badges) over darkened footage. Practical, save-worthy tips.
- Topic should be a practical, save-worthy list tied to the focus service ("things to do after your facial", "ways to make results last").
- The angle is the list framing, and the title references the count (e.g. "5 THINGS TO DO RIGHT AFTER YOUR FACIAL").
- The payoff is the set of genuinely useful, specific tips the viewer can act on.`,
};

/**
 * Build system + user messages for generating a `VideoIdea` for one slot of
 * the organic content planner. One LLM call produces a small narrative blob
 * that BOTH the on-screen video copy and the long-form post caption are
 * derived from downstream — so the video and the caption tell one coherent
 * story.
 */
export function buildVideoIdeaPrompt(
  orgContext: OrgContext,
  templateId: OrganicTemplateId,
  serviceName: string
): { systemMessage: string; userMessage: string } {
  const businessType =
    businessTypeLabels[orgContext.businessType] || orgContext.businessType;
  const orgBlock = buildOrgContextBlock(orgContext);
  const formatHints = TEMPLATE_FORMAT_HINTS[templateId];

  const systemMessage = `You are a social-media content strategist for a ${businessType}.
Your job is to plan the narrative for one short-form organic video (Instagram Reels / TikTok / YouTube Shorts).

You are NOT writing the on-screen copy or the post caption directly — a separate downstream step does that. You are producing the IDEA both surfaces share. The on-screen text and the long-form caption will be derived from your output, so the video and the post must tell ONE coherent story.

Voice rules:
- Match the brand voice described below.
- Specific, useful, and confident. No fluff, no generic advice.
- Avoid clinical jargon — sound like a knowledgeable friend, not a brochure.
- Do not invent numbers or claims that may not be true.

Output: respond with valid JSON ONLY matching the exact shape requested. No prose, no markdown.`;

  const userMessage = `Generate a single video idea for one slot of this month's organic content plan.

${orgBlock}

FOCUS SERVICE: "${serviceName}"

${formatHints}

The idea must work for BOTH surfaces it feeds:
- An ~8-second on-screen video (the angle is the hook, kept punchy and concrete).
- A 2-3 sentence post caption (the topic + payoff give the caption a real, useful body).
If the topic only works as a video hook (no caption substance) OR only as a caption (too dense for an 8s hook), it's wrong. Pick a topic that pays off cleanly on both.

Return JSON in this EXACT shape:
{
  "topic": string,        // 30-160 chars. The specific thing this video is about. One sentence, concrete.
  "angle": string,        // 20-100 chars. The on-screen hook angle the video opens on.
  "payoff": string,       // 20-120 chars. The key takeaway the caption delivers by the end.
  "audience": string,     // 10-60 chars. Who this is for, in plain language. Reference the brand's target audience.
  "serviceName": string   // EXACTLY "${serviceName}" — copy this string verbatim, do not rewrite.
}`;

  return { systemMessage, userMessage };
}
