/**
 * A graphic prompt as a VALUE, in two channels.
 *
 * ## Why two channels
 *
 * Three separate defects share one shape — something stated in the prompt was
 * DRAWN onto the canvas instead of being acted upon:
 *
 *   - `Slide 4/7` rendered as literal text, from "This is slide 4 of 7"
 *   - BEFORE/AFTER labels rendered, from a copy spec that asked for them
 *   - pagination dots drawn, from a template that described them
 *
 * They kept being fixed one at a time by rewording, and a reworded instruction
 * is still an instruction sitting in the same undifferentiated prose blob as
 * the words the model is supposed to render. There was no way for the model to
 * tell "here is what to draw" from "here is how to draw it", because they
 * arrived as one string joined with spaces.
 *
 * So a prompt is now a pair: DIRECTIVES about the render, and COPY to render.
 * Only strings inside the copy block may appear as words in the artwork. That
 * is one rule covering a class of bug rather than three wordings covering three
 * instances of it.
 *
 * ## Why a value and not a string
 *
 * The single most expensive mistake of the work this came out of was four
 * rewordings of an instruction about reference images that were never being
 * sent — nobody had read the assembled prompt end to end, because there was
 * nowhere it existed as an inspectable thing. Building a structure and
 * serialising it once means the prompt can be snapshot-tested, diffed between
 * two configurations, and printed without a debug flag threaded through five
 * call sites.
 */

import { z } from 'zod';

/**
 * The exact strings to render, by role.
 *
 * Named fields rather than one blob so a template can say "this slide has a
 * heading and a CTA and no body" structurally, instead of hoping prose conveys
 * it — and so `footer` can carry the one canonical handle without the model
 * treating it as body copy.
 */
export interface RenderCopy {
  heading?: string;
  body?: string;
  cta?: string;
  footer?: string;
  /**
   * Copy that does not decompose into the roles above — a planner's free-form
   * slide text. Kept verbatim; still inside the copy channel, so it is still
   * distinguishable from an instruction.
   */
  raw?: string;
}

export const renderCopySchema = z.object({
  heading: z.string().optional(),
  body: z.string().optional(),
  cta: z.string().optional(),
  footer: z.string().optional(),
  raw: z.string().optional(),
});

export interface GraphicPrompt {
  /** Instructions ABOUT the render. Never rendered as words. */
  directives: string[];
  /** The strings TO render, or null when the caller plans no copy. */
  copy: RenderCopy | null;
}

const COPY_OPEN = '=== COPY TO RENDER ===';
const COPY_CLOSE = '=== END COPY ===';

/**
 * The rule that makes the split mean something.
 *
 * Stated once, next to the delimiter it refers to, rather than restated as a
 * negative in every template ("do not render this line as text", "do not draw
 * the slide number", "context only").
 */
const CHANNEL_RULE = `EVERYTHING ABOVE is instruction about HOW to build this graphic — it describes the render and must NEVER be drawn as words, numbers or labels in the artwork. The ONLY text that may appear in the finished image is the text between ${COPY_OPEN} and ${COPY_CLOSE} below. Render those strings exactly as written, including their spelling and capitalisation; do not add slide numbers, role names, section headings, field labels, or any other words of your own.`;

const NO_COPY_RULE =
  'No copy has been planned for this graphic. Do NOT invent headings, body text, captions, labels or slide numbers — everything above is instruction about the render and none of it may be drawn as words.';

function copyLines(copy: RenderCopy): string[] {
  const out: string[] = [];
  if (copy.heading?.trim()) out.push(`HEADING: ${copy.heading.trim()}`);
  if (copy.body?.trim()) out.push(`BODY: ${copy.body.trim()}`);
  if (copy.cta?.trim()) out.push(`CTA: ${copy.cta.trim()}`);
  if (copy.footer?.trim()) out.push(`FOOTER: ${copy.footer.trim()}`);
  if (copy.raw?.trim()) out.push(copy.raw.trim());
  return out;
}

/** True when the copy block carries nothing worth a channel of its own. */
export function isEmptyCopy(copy: RenderCopy | null | undefined): boolean {
  return !copy || copyLines(copy).length === 0;
}

/**
 * Render the prompt to the single string the image model receives.
 *
 * Deliberately the ONLY place the two channels are joined, so the delimiter and
 * the rule describing it can never drift apart.
 */
export function serialiseGraphicPrompt(prompt: GraphicPrompt): string {
  const directives = prompt.directives
    .map((d) => d.trim())
    .filter(Boolean)
    .join(' ');

  if (isEmptyCopy(prompt.copy)) {
    return `${directives} ${NO_COPY_RULE}`.trim();
  }

  const body = copyLines(prompt.copy as RenderCopy).join('\n');
  return `${directives}\n\n${CHANNEL_RULE}\n\n${COPY_OPEN}\n${body}\n${COPY_CLOSE}`.trim();
}
