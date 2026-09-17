import { businessTypeLabels } from '@borradh-workspace/labels';
import {
  type OrgContext,
  buildOrgContextBlock,
} from '../../../shared/org-context.js';
import type { OrganicVariationId } from './generate-organic-copy.schema.js';

/**
 * Build system + user messages for generating organic-template copy.
 *
 * Each variation has its own output contract — the prompt tells the model
 * exactly which JSON shape to return. The caller validates the result
 * against the matching zod schema.
 */
export function buildOrganicCopyPrompt(
  orgContext: OrgContext,
  variationId: OrganicVariationId,
  refinement?: { instruction?: string; priorCopy?: Record<string, unknown> }
): { systemMessage: string; userMessage: string } {
  const businessType =
    businessTypeLabels[orgContext.businessType] || orgContext.businessType;
  const orgBlock = buildOrgContextBlock(orgContext);

  const focusService = orgContext.serviceDetails[0];
  const serviceLine = focusService
    ? `\nFOCUS SERVICE: "${focusService.name}"\n${
        focusService.painPoints?.length
          ? `Pain points addressed: ${focusService.painPoints.join(', ')}\n`
          : ''
      }${
        focusService.expectedResults?.length
          ? `Expected results: ${focusService.expectedResults.join(', ')}\n`
          : ''
      }${
        focusService.targetArea
          ? `Target area: ${focusService.targetArea}\n`
          : ''
      }`
    : '';

  const baseSystem = `You are a short-form social copywriter for a ${businessType}.
You write hooks for ~8-second organic Instagram / TikTok videos.

${orgBlock}
${serviceLine}
Voice rules:
- Match the brand voice described above.
- Direct, confident, no fluff. No hashtags. No emojis unless the schema explicitly asks for one.
- Avoid clinical jargon — sound like a friendly expert, not a medical pamphlet.
- The video itself shows procedure footage; the copy is the hook that makes viewers stop scrolling.

Output: respond with valid JSON ONLY, matching the exact shape below. No prose, no markdown.`;

  const base = ((): { systemMessage: string; userMessage: string } => {
    switch (variationId) {
      case 'caption-tease-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Caption Tease" organic video format.

Layout: a single serif headline appears center-screen with one word bolded for emphasis, optionally followed by an emoji. Underneath, a short cursive caption reads "Check the caption" (or a similar short hook nudging the viewer to read the caption).

Headline rules:
- One sentence, max ~14 words.
- Make a specific, surprising, or hard-to-ignore claim about the focus service (or the business more broadly if no service is set).
- Use a concrete number when natural ("up to 70%", "in 3 sessions"). If unsure of exact numbers, omit rather than invent.
- Pick ONE word to bold for emphasis — a small word ("ONE", "FREE", "NEW") or a number works best. Set "emphasis" to that exact word as it appears in the headline.

Emoji rules:
- Optional. Only if it punches up the headline (😱 🤯 ✨ 🔥 etc.). Skip when in doubt.

Caption rules:
- Short, 2-4 words. Examples: "Check the caption", "Read this", "Full story below". Always nudge the viewer downward.

Return JSON in this exact shape:
{
  "headline": string,
  "emphasis": string | null,   // omit or null if no word is bolded
  "emoji": string | null,      // omit or null if no emoji
  "caption": string
}`,
        };

      case 'fade-benefits-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Fade-In Benefits" organic video format.

Layout: lines appear one at a time, centered in a bold serif in the middle of the frame. Each reveals word-by-word with a soft fade over calm procedure footage.

Line rules:
- The FIRST line is JUST the service name (the focus service above), nothing else — it opens the video.
- Then provide 3-4 short benefit statements that build on each other (benefit → outcome → soft nudge).
- Each benefit statement: a single short line, max ~8 words (~55 characters). No trailing punctuation needed.
- Lead with the felt benefit. Examples (after the service name): "Perfect for active breakouts and congestion", "Calms inflammation and helps spots heal faster", "The reset your skin has been waiting for".
- Concrete and specific to the focus service; calm, premium tone. No hashtags, no emojis.

Return JSON in this exact shape:
{
  "lines": string[]   // first line = the service name, then 3-4 benefit statements, in display order
}`,
        };

      case 'highlight-caption-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Highlight Caption" organic video format.

Layout: short lines appear one at a time, each on a solid brand-colour highlight block in the middle of the frame, over procedure footage. The trending, high-retention reel caption format.

Line rules:
- The FIRST line is a punchy, scroll-stopping hook that names a feeling or pain point (≤7 words). E.g. "Your skin, but make it glow".
- Then provide 3-4 short caption statements that build a story (hook → insight → payoff → soft nudge).
- Each line: max ~7 words (~40 characters) so it fits one highlight block. Sentence case, no trailing punctuation.
- Confident and relatable; concrete to the focus service. No hashtags, no emojis.

Return JSON in this exact shape:
{
  "lines": string[]   // the hook line, then 3-4 caption statements, in display order
}`,
        };

      case 'aesthetic-line-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Aesthetic Line" organic video format.

Layout: a single understated lowercase serif line, lower third of the frame, fades in gently over calm footage. Quiet, relatable, scroll-stopping vibe — like a thought or a mood, NOT a hard sell.

Line rules:
- The line MUST start with "this & " and then a SHORT, PERSONAL ending (max ~3 words after it). Keep the WHOLE line ~28 characters or fewer — roughly the length of "this & thinking about nothing".
- The ending is a personal fantasy / feeling / identity — usually first person ("my ..."). It is NOT a clinical benefit or feature of the treatment.
  • Relaxing / experience (massage, facial, spa, etc.) → a calm, personal mood. Examples: "this & thinking about nothing", "this & protecting my peace", "this & my me-time".
  • Results-driven treatment (fat freezing, skin tightening, etc.) → the dream identity/outcome. Examples: "this & my dream body", "this & my dream skin", "this & my glow up".
- DO NOT use clinical/feature phrasing. Bad: "this & smoother skin", "this & less fat", "this & clearer skin". Good: "this & my dream skin".
- Lowercase, no trailing punctuation, no hashtags, no emojis, no CTA.

Return JSON in this exact shape:
{
  "text": string   // "this & " + a short personal fantasy; whole line ~28 chars max
}`,
        };

      case 'numbered-list-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Numbered List" organic video format.

Layout: a bold uppercase title at the top, then a numbered list (each item with a number badge) over darkened footage. Practical, save-worthy tips.

Title rules:
- ~5-8 words, references the count. Example: "5 THINGS TO DO RIGHT AFTER YOUR FACIAL".

Item rules:
- 3-6 items. Each item: 2-6 words MAX, imperative voice (start with a verb). Examples: "Avoid sunbeds", "Keep your hands off your face".
- Keep them genuinely useful and specific to the service/niche.

Return JSON in this exact shape:
{
  "title": string,
  "items": string[]
}`,
        };

      case 'ins-outs-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "INS + OUTS" organic video format.

Layout: a bold title at the top of the frame, then two columns of short items underneath an "INS" header (positive) and an "OUTS" header (negative). Items render on a single line each, so KEEP THEM SHORT.

Title rules:
- Uppercase-friendly, ~4-7 words.
- Reference the current year (use 2026) and the niche. Example: "2026 SKINCARE INS + OUTS" for an aesthetics clinic.
- Match the niche of the business above.

INS / OUTS rules:
- Provide 5-7 items in each list.
- Each item: 1-4 words MAX. Must read clearly on a single line — long phrases get cropped.
- INS = things to embrace this year (treatments, habits, mindsets) relevant to the business.
- OUTS = things to drop (myths, bad habits, outdated practices) relevant to the business.
- Items should NOT repeat across the two lists.
- Capitalize naturally (Title Case for proper nouns + start of item, sentence case otherwise).

Return JSON in this exact shape:
{
  "title": string,
  "insLabel": "INS",
  "insItems": [string, ...],
  "outsLabel": "OUTS",
  "outsItems": [string, ...]
}`,
        };

      case 'curiosity-hook-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Curiosity Hook" organic video format.

Layout: a bold, surprising claim pinned to the top of the frame, and a short "watch till the end" style nudge pinned to the bottom. Both are rendered as black text with a thick white outline so they read over busy footage. The claim is a curiosity gap that makes viewers keep watching to find out why.

Claim rules (the "question" field):
- A bold, specific, curiosity-gap statement — NOT a literal question. 5-10 words.
- It should make the viewer think "wait, what?" and keep watching.
- Tie it to the focus service if set, otherwise the business' niche.
- Examples for an aesthetics clinic: "Most people book this treatment for the wrong reason", "You've been treating dull skin backwards", "This is why your results never last".
- No greetings, no preamble. No literal question mark.

CTA rules (the "ctaText" field):
- A short "keep watching" nudge, 2-5 words. Default: "Watch till the end".
- Acceptable alternatives: "Here's why", "Wait for it", "Keep watching".

Return JSON in this exact shape:
{
  "question": string,
  "ctaText": string
}`,
        };

      case 'question-cta-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Question + Read Caption" organic video format.

Layout: a short question pinned to the top of the frame, and a "Read caption ⬇" style CTA pinned to the bottom. Both are rendered as black text with a thick white outline so they read over busy footage. The question is the hook — the full answer lives in the post caption.

Question rules:
- One direct question, 4-9 words.
- About the focus service if set, otherwise about the business' niche.
- Examples for an aesthetics clinic: "How long should your botox last?", "Is microneedling worth it?", "Why does my skin look dull?".
- No greetings, no preamble. Punch straight into the question.

CTA rules:
- Short downward nudge. Default: "Read caption ⬇".
- Acceptable alternatives: "Full story below ⬇", "Tap caption ⬇", "Answer below ⬇".

Return JSON in this exact shape:
{
  "question": string,
  "ctaText": string
}`,
        };

      case 'improves-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Service Improves" organic video format.

Layout: opens on the service name in big caps, cuts through 2-4 short "IMPROVES: <item>" beats — one clip per item — and ends on a short closing CTA encouraging viewers to start their journey.

Service name rules:
- All caps version of the focus service name (or the business' headline service if none is set).
- Examples: "MICRONEEDLING", "BOTOX", "DERMAL FILLERS", "HYDRAFACIAL".

Items rules:
- 2-4 items. Each item is 1-3 words. Uppercase-friendly.
- Concrete benefits viewers actually search for. Examples for microneedling: "SKIN TEXTURE", "FINE LINES", "ACNE SCARS", "PORES". Avoid abstract ones like "WELLNESS" or "BEAUTY".
- Use the service's expected results (above) when available.

CTA rules:
- One short sentence, ~6-10 words. Sentence case (not all caps).
- Format: "Start your <service> journey today" or "Book your <service> consultation today" or a similar journey-style nudge. Always include the service name lowercased.

Return JSON in this exact shape:
{
  "serviceName": string,
  "items": [string, ...],
  "ctaText": string
}`,
        };

      case 'step-timer-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Step + Timer" organic video format.

Layout: a bold uppercase title stays at the top, then numbered timed steps reveal ONE per clip over darkened footage — each shows a number badge, a short step name, and a duration pill. Save-worthy routine / protocol content.

Title rules:
- ~4-8 words, references the count and the routine. Example: "YOUR 4-STEP GLOW ROUTINE", "3-STEP FAT FREEZING PREP".

Step rules:
- 3-4 steps. Each step has a short "label" (2-5 words, imperative or noun phrase) and a "duration" (a short time string).
- "label" examples: "Cleanse the area", "Numbing cream", "Botox assessment", "Cool down".
- "duration" is a SHORT human time: "60 sec", "5 min", "20 min", "overnight". Keep it under ~10 characters. Make the times realistic for the step and service.
- Steps should read as a genuine, in-order routine for the focus service.

Return JSON in this exact shape:
{
  "title": string,
  "steps": [ { "label": string, "duration": string }, ... ]
}`,
        };

      case 'time-progress-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Time-lapse Progress" organic video format.

Layout: a large "startLabel → endLabel" timestamp (e.g. "Day 1 → Day 30") sits centered over before→after footage, with a short caption beneath. Communicates visible results over time.

Timestamp rules:
- "startLabel" and "endLabel" mark a realistic progress window for the focus service. Each ≤ ~10 characters.
- Use the unit that fits the treatment's real timeline: "Day 1"/"Day 30", "Week 1"/"Week 6", "Session 1"/"Session 6", "Before"/"After".
- Pick a span that is honest for the service (e.g. fat freezing shows over weeks, not a day).

Caption rules:
- ONE short line, max ~6 words (~40 chars). Names the transformation. Sentence case, no trailing punctuation, no hashtags, no emojis.
- Examples: "Real fat-freezing results", "Skin that keeps improving", "Your 6-week transformation".

Return JSON in this exact shape:
{
  "startLabel": string,
  "endLabel": string,
  "caption": string
}`,
        };

      case 'poll-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Engagement Poll" organic video format.

Layout: a bold question pinned to the top, then vote rows centred over the footage — viewers vote with Instagram's own actions: LIKE the post for option one, COMMENT for option two, and optionally SHARE for a third. Results show natively on the post (like/comment counts), so options must be genuinely debatable.

Question rules:
- One direct A/B (or A/B/C) question, 4-9 words. Examples: "Which would you pick?", "Team smooth or team sculpted?", "Which glow-up wins?".
- Tie it to the focus service or the business' niche.

Option rules:
- "likeLabel" and "commentLabel" are SHORT labels (1-4 words, ≤30 chars) people genuinely argue about. Same category, real trade-off.
- Examples for an aesthetics clinic: "Botox" vs "Filler", "Natural look" vs "Full glam", "Morning routine" vs "Night routine".
- PREFER three options: include "shareLabel" whenever a third genuinely distinct pick exists (most polls should have all three — like, comment AND share). Only fall back to two when a third would feel forced; then set it null.
- Never a throwaway option — every option must be a pick people are proud to vote for.

Return JSON in this exact shape:
{
  "question": string,
  "likeLabel": string,
  "commentLabel": string,
  "shareLabel": string | null
}`,
        };

      case 'myth-fact-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Myth → Fact" organic video format.

Layout: a red MYTH pill with a confidently-wrong belief on a cream card, which flips to a green FACT pill with the correction. 1-2 myth/fact pairs, optional series label persisting up top, optional closing CTA.

Rules:
- Each "myth" is a belief the viewer plausibly HOLDS, stated confidently, ≤90 chars, no "Myth:" prefix.
- Each "fact" starts with the correction itself (never "Actually..."), ≤120 chars, specific to the focus service.
- "seriesTitle": ≤24 chars series label like "FAT FREEZING MYTHS" (or null).
- "ctaText": short closing nudge ≤40 chars (or null).

Return JSON in this exact shape:
{
  "seriesTitle": string | null,
  "pairs": [ { "myth": string, "fact": string }, ... ],
  "ctaText": string | null
}`,
        };

      case 'versus-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "X vs Y" treatment-comparison organic video format.

Layout: the two treatment names stacked on cards with a VS chip, then attribute rounds (label pill + one answer bar per treatment), closing on a verdict card.

Rules:
- "treatmentA"/"treatmentB": the exact decision viewers weigh (e.g. the focus service vs its most-compared alternative). ≤14 chars each.
- 2-4 "rounds", each with "label" ≤12 chars caps-friendly ("PAIN", "COST", "LASTS", "BEST FOR") and per-treatment answers ≤45 chars.
- "verdict": MUST be "it depends on goal X vs goal Y" framing, ≤100 chars — never crown a winner; the clinic offers both.

Return JSON in this exact shape:
{
  "treatmentA": string,
  "treatmentB": string,
  "rounds": [ { "label": string, "aValue": string, "bValue": string }, ... ],
  "verdict": string
}`,
        };

      case 'price-reveal-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Price Reveal" organic video format.

Layout: a price-question hook up top, then a receipt that builds one line-item per beat, and the TOTAL stamping down big on the final beat with an optional value-comparison line.

Rules:
- "hook": the unGoogleable price question, ≤70 chars, names the focus treatment (e.g. "What does fat freezing actually cost?").
- 3-4 "items": name ≤28 chars + price ≤9 chars (currency symbol included). Realistic itemisation of the focus service (consult, session, aftercare...).
- "totalPrice": ≤9 chars, must equal a plausible sum of the items.
- "valueLine": optional comparison ≤60 chars (e.g. "less than a gym year"), or null.

Return JSON in this exact shape:
{
  "hook": string,
  "items": [ { "name": string, "price": string }, ... ],
  "totalPrice": string,
  "valueLine": string | null
}`,
        };

      case 'client-question-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Client Question" organic video format.

Layout: a reply-sticker bubble with a real-looking client question pinned top-left the whole video; answer beats swap in the lower third.

Rules:
- "question": first-person, casual, the kind of DM the clinic actually gets about the focus service. ≤110 chars, may include ONE emoji and informal phrasing.
- "asker": a fake-anonymised handle like "sarah_x" or "jess.m" — ≤14 chars, never a real name+surname.
- 3-4 "answers": beat 1 answers DIRECTLY (yes/no/number), later beats add nuance. Each ≤80 chars.
- "ctaText": comment-prompt closer ≤60 chars (e.g. "Got a question? Drop it below 👇"), or null.

Return JSON in this exact shape:
{
  "question": string,
  "asker": string,
  "answers": [string, ...],
  "ctaText": string | null
}`,
        };

      case 'come-with-me-1':
        return {
          systemMessage: baseSystem,
          userMessage: `Write copy for the "Come With Me" mini-vlog organic video format.

Layout: a handwritten script title centre-frame ("come get a hydrating facial with me"), then lowercase diary-tone step captions riding the top of the frame one beat at a time, closing on the clinic CTA. Calm is the aesthetic.

Rules:
- "title": MUST start with "come" (or "spend ... with me"), all lowercase, ≤60 chars, ≤2 emoji, names the focus treatment experience.
- "seriesChip": optional tiny series marker ≤12 chars (e.g. "ep. 3"), or null.
- 4-5 "steps": lowercase sensory captions ≤45 chars, diary tone; at least one may be a ">>>" or parenthetical aside (e.g. "the warm steam >>>", "lymphatic massage (fell asleep)").
- "closingCta": ≤50 chars, warm, includes a soft booking nudge.

Return JSON in this exact shape:
{
  "title": string,
  "seriesChip": string | null,
  "steps": [string, ...],
  "closingCta": string
}`,
        };
    }
  })();

  // Refinement: when the user re-rolls with an instruction (and we have the
  // previous copy), regenerate from it and apply ONLY the requested change so
  // the result stays consistent with what they already saw. On first
  // generation with only an instruction, treat it as upfront guidance.
  const instruction = refinement?.instruction?.trim();
  if (!instruction) return base;

  const priorBlock = refinement?.priorCopy
    ? `\n\nPREVIOUS COPY (the user has already seen this — JSON):\n${JSON.stringify(
        refinement.priorCopy
      )}\n\nThe user asked for this change — apply it and return the SAME JSON shape with ONLY that change (keep everything else as close to the previous copy as possible): ${instruction}`
    : `\n\nUser instruction (steer the copy accordingly): ${instruction}`;

  return {
    systemMessage: base.systemMessage,
    userMessage: base.userMessage + priorBlock,
  };
}
