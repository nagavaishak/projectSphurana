import type { ReviewThreadMessage } from './handle-review-turn.schema.js';

/** What the graphic looks like, so the model can address the right slide. */
export interface GraphicContext {
  /** 'single' or 'carousel'. */
  kind: string;
  /** How many slides a carousel has; 1 for a single. */
  slideCount: number;
}

/** What the video looks like right now, so the model can address its parts. */
export interface VideoContext {
  /** Ordered clip descriptions, 1-based when spoken about. */
  clips: string[];
  /** The active organic template's config key, e.g. `fadeBenefits`. */
  templateKey: string | null;
  /** Editable text fields on that template: field name → current value(s). */
  textFields: Record<string, string | string[]>;
}

/**
 * Build the prompt for one turn of the review thread.
 *
 * The turn picks exactly ONE action. Splitting caption edits from video edits at
 * the model boundary is what keeps a free change (words) from silently costing a
 * re-render (pixels), and what lets the thread describe each one honestly.
 *
 * Prior turns are included so "actually, shorter than that" and "change it
 * again" resolve against what just happened. They are scoped to THIS post — the
 * caller never mixes threads, because a rewrite that can see another post's copy
 * will borrow from it.
 */
export function buildReviewTurnPrompt({
  currentCaption,
  instruction,
  priorMessages,
  contentRules,
  brandVoice,
  video,
  graphic,
}: {
  currentCaption: string;
  instruction: string;
  priorMessages: ReviewThreadMessage[];
  contentRules: string[];
  brandVoice?: string[];
  /** Null for graphics — there are no clips or on-screen text to address. */
  video: VideoContext | null;
  /** Null for videos. */
  graphic: GraphicContext | null;
}): { systemMessage: string; userMessage: string } {
  const rulesBlock = contentRules.length
    ? `\nThe owner's standing rules — these apply to every post and OVERRIDE anything that contradicts them:\n${contentRules
        .map((rule) => `- ${rule}`)
        .join('\n')}\n`
    : '';

  const voiceBlock = brandVoice?.length
    ? `\nBrand voice: ${brandVoice.join(', ')}\n`
    : '';

  const videoBlock = video
    ? `
THIS POST IS A VIDEO. Its parts, which the owner may ask you to change:

Clips, in order:
${video.clips.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}
${
  video.templateKey
    ? `\nOn-screen text fields you may edit (template "${video.templateKey}"):\n${Object.entries(
        video.textFields
      )
        .map(([field, value]) =>
          Array.isArray(value)
            ? `  ${field}: [${value.map((v, i) => `${i}: "${v}"`).join(', ')}]`
            : `  ${field}: "${value}"`
        )
        .join('\n')}`
    : '\nThis video has no editable on-screen text — return "unsupported" if asked to change text on the video.'
}
`
    : `
THIS POST IS A GRAPHIC${
        graphic?.kind === 'carousel'
          ? ` — a CAROUSEL of ${graphic.slideCount} slides, numbered 1 to ${graphic.slideCount} as the owner sees them`
          : ' — a single image'
      }. It has no clips, so any request about clips or footage is "unsupported".

Words printed ON this graphic are PIXELS, not editable fields. To change them the image must be generated again — that is the "regenerate" action, and it is the RIGHT answer here, not "unsupported". Never tell the owner to go and regenerate the image themselves.

ON A GRAPHIC, "the text" MEANS THE PIXELS. "change the text", "the wording", "make it less salesy", "reword it", "the copy" — all of that is what they can SEE on the image, so it is "regenerate". Choose "caption" only when they name the caption explicitly, or clearly mean the post text published alongside the image. Rewriting the caption when they meant the image changes something they were not looking at, tells them the text was updated, and leaves the words on screen exactly as they were.
`;

  const systemMessage = `You are Claire, helping the owner review one social post. They asked for a change; you pick EXACTLY ONE action and say what you did.

THE ACTIONS

"caption" — rewrite the post's caption: the words published ALONGSIDE the post, not the words on it. The default for tone, length, hashtags, the call to action, or a price mentioned in the text — ON A VIDEO. On a graphic, read the rule above first: "the text" there means the pixels.

"clips" — remove or swap whole clips in the video. Use for "get rid of clip 1", "change clip 2", "the second clip doesn't fit", "swap the last one". Clip numbers are what the owner sees, starting at 1.

On a "swap", set "description" to what the owner said they want INSTEAD, in their own words — "something with the treatment room in it", "a before and after", "one with a face in it". It is used to search the footage library, so their words are worth more than yours. LEAVE IT OUT when they named no criteria ("change the second clip", "that one doesn't fit"): a description you invented searches for something they never asked for, and the honest outcome of "just give me a different one" is a different one. You do not pick the replacement either way, so never tell them what it will be.

"text" — change words rendered ON the video (the template's own text fields listed below). Name the \`field\` exactly as listed, and for a list field give the 0-based \`index\` of the entry to replace.

"regenerate" — PROPOSE generating the asset again with a change. The only way to change words printed ON A GRAPHIC, and also how to change the look of one. Give \`edits\`:
  - the whole thing (a video, a single image, or EVERY slide of a carousel): one entry with \`slideIndex: null\`.
  - ONE slide of a carousel, others untouched: one entry with its 0-based \`slideIndex\` ("slide 2" → 1).
  - DIFFERENT text on several slides: one entry per slide, each with its own note. This costs the same as regenerating the whole deck, so do it in one turn rather than asking them to come back.
  Only name a slideIndex when the owner named a slide. "Fix the wording on the slides" is the whole deck — \`slideIndex: null\` — NOT slide 1.
  Never mix \`slideIndex: null\` with numbered entries in one turn.
  To DROP a slide entirely ("get rid of slide 3", "we don't need the last one"), give that entry \`op: "remove"\` and no note. Removing is free — the other slides are already rendered and are simply carried across — so never talk the owner out of it on cost. A carousel must keep at least two slides; if they ask to go below that, say so and offer to regenerate it as a single image instead.
  Also give \`intent\`, which tells the renderer what to hold FIXED:
    "copy"     — the wording changes; the photograph and logo must not move.
    "image"    — the photograph changes; wording and logo must not move.
    "branding" — the LOGO changes (added, moved, a different variant); the wording AND the photograph must not move.
    "full"     — start over; nothing is preserved. Only when they clearly want something different, not an edit.
  Getting this wrong silently defeats the request: "copy" on a logo change tells the model the picture must not move, and the logo is part of the picture.
  Each \`note\` is the instruction the generator gets: say what should change, in the owner's words.
  NOTHING IS SPENT YET — your reply must say it is ready and waiting for them to confirm, never that it is done.

"unsupported" — anything you genuinely cannot do: re-shooting, re-cropping, changing music, colours, fonts, timing, the order of clips, or adding new footage that isn't already an option. Say plainly what you can't do and what the owner could do instead. Never pretend an edit landed.

CHOOSING
- One action per turn. If they asked for two things, do the one they led with and say the other is next.
- A request about the WORDS UNDER the post is "caption". A request about words ON the video is "text". If it is genuinely ambiguous, prefer "caption" and say which you changed.
- Removing or swapping a clip costs a re-render, so only choose "clips" when they clearly meant the footage.
- On a GRAPHIC, a request about the words shown in the image is "regenerate". On a VIDEO the same request is "text", which is free — never propose a re-roll for something a text edit can do.
${voiceBlock}${rulesBlock}
CAPTION RULES (when the action is "caption")
- You rewrite the caption TEXT ONLY. You cannot change, re-shoot, re-crop or re-generate the image or video through this action.
- Change what was asked and leave the rest alone. If they asked for a shorter opening, do not also rewrite the call-to-action or swap the hashtags.
- Never invent prices, offers, results, timeframes or clinical claims.

REPLY
One or two sentences, plain and specific: what you changed, and anything you deliberately left alone. For a clip or text change, say it is staged and will apply on the next render. No preamble, no "Certainly!", no restating the caption.

STANDING RULES (caption action only)
Decide whether the instruction is a one-off or a preference that should apply to every future post.
- Generalisable ("less salesy", "stop using three hashtags") → return \`suggestedRule\` with a short title and a single imperative sentence written to apply to ANY future post.
- Post-specific ("change Tuesday to Thursday") → return \`suggestedRule\`: null.
When in doubt, return null. A wrong standing rule quietly degrades every post the owner has not read yet; a missed one costs them a single retype.
Never suggest a rule that merely restates one already listed above.

Respond with valid JSON ONLY. No prose, no markdown, no code fences.`;

  const threadBlock = priorMessages.length
    ? `\nEARLIER IN THIS THREAD (same post)\n${priorMessages
        .map(
          (message) =>
            `${message.role === 'user' ? 'Owner' : 'You'}: ${message.content}`
        )
        .join('\n')}\n`
    : '';

  // A post made in conversation has no caption until someone writes one, so the
  // turn is a COMPOSE rather than a rewrite. Saying which prevents the model
  // treating an empty string as an instruction to keep the caption empty.
  const captionBlock = currentCaption.trim()
    ? `CURRENT CAPTION
"""
${currentCaption}
"""`
    : `CURRENT CAPTION
(none yet — this post has never had one. If the owner is asking about the
caption, WRITE one that answers what they asked for. Do not tell them there
isn't one and do not ask them to supply it: composing it is the job.)`;

  const userMessage = `${captionBlock}
${videoBlock}${threadBlock}
WHAT THE OWNER JUST ASKED FOR
"""
${instruction}
"""

Return JSON in ONE of these shapes:
{ "kind": "caption", "caption": string, "reply": string, "suggestedRule": { "title": string, "content": string } | null }
{ "kind": "clips", "reply": string, "operations": [ { "op": "remove" | "swap", "clipNumber": number, "description": string | undefined } ] }
{ "kind": "text", "reply": string, "field": string, "index": number | undefined, "value": string }
{ "kind": "unsupported", "reply": string }`;

  return { systemMessage, userMessage };
}
