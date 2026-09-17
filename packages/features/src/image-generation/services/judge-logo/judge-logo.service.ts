/**
 * `judgeLogo` — compare the mark on a finished graphic against the real logo.
 *
 * ## Why this is its own service and not a line in `inspectGraphic`
 *
 * The gate already has a re-typeset rule, and it MISSED a plainly re-typeset
 * mark: Skin from Brazil's `testimonial-quote` came back with the business name
 * in an ordinary serif and no leaf emblem, and the gate reported only the stray
 * numerals on the same image. A dedicated judge, given the same two images,
 * called it immediately.
 *
 * The difference is specificity. `inspectGraphic` runs a ten-item checklist —
 * duplicated text, markdown characters, overlaps, social chrome, invented
 * people, malformed handles AND logo comparison — and is deliberately tuned
 * conservative, because a gate that over-fires gets switched off. Comparing two
 * images of a mark is a different kind of task from scanning one image for
 * faults, and asking one call to do both means the rare, specific judgement
 * loses to the common, general one.
 *
 * So: one call, one job, one pair of images.
 *
 * ## Why it matters that this runs in production
 *
 * This check lived only in `scripts/render-org-sample.ts` for the whole of the
 * work on ENG-542 — the bug it detects. The test harness could see the defect
 * that the shipping pipeline could not, so a re-typeset mark reached owners
 * while the branch investigating it reported clean runs.
 *
 * FAILS OPEN, like every other observability layer here: a judgement that could
 * not be made is not a failed render.
 */

import { createAnthropicClient } from '@borradh-workspace/ai';
import { logError, trackedResult } from '@borradh-workspace/observability';
import sharp from 'sharp';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { extractJsonObject } from '../../extract-json-object.js';
import {
  type JudgeLogoInput,
  type LogoVerdict,
  judgeLogoSchema,
  logoVerdictValues,
} from './judge-logo.schema.js';

const VISION_MODEL = 'claude-sonnet-4-6';
/** The graphic: enough to read a wordmark. */
const GRAPHIC_MAX_EDGE = 900;
/** The reference logo: it only has to be recognisable, not legible at size. */
const LOGO_MAX_EDGE = 400;
/** The cropped mark, upscaled so the two emblems are compared at like sizes. */
const MARK_MAX_EDGE = 400;

export interface LogoJudgement {
  verdict: LogoVerdict;
  /** One short clause naming what is wrong. Empty when correct. */
  note: string;
  /** Convenience: anything other than `correct`. */
  isDefect: boolean;
  /**
   * WHICH image stage 2 actually judged.
   *
   * `cropped`   — the mark was located and judged filling the frame.
   * `fallback`  — localisation failed or produced an unusable box, so the
   *               whole graphic was judged, as it was before two-stage.
   * `not-found` — stage 1 reported no mark at all.
   *
   * Reported because the fallback is SILENT: a clean run is consistent with
   * "cropping works" and with "stage 1 failed every time and this is the old
   * behaviour". Without this field the verdicts are not interpretable.
   */
  localisation: 'cropped' | 'fallback' | 'not-found';
}

const SYSTEM = `You are shown TWO images: first the brand's REAL logo, then a generated graphic for that same brand.

Judge ONLY the brand mark in the second image. Ignore layout, copy, colour scheme and photography.

Return JSON only: { "verdict": "correct" | "re-typeset" | "substituted" | "distorted" | "absent" | "duplicated" | "recoloured-container", "note": "<one short clause>" }

  correct              — the icon/emblem is THE SAME DEVICE as the real logo's, and the name is set in the same letterforms. A different SIZE, PLACEMENT or COLOURWAY is still correct, and so is the name shown with NO icon container at all.
  re-typeset           — the business NAME set in an ordinary font instead of the brand's actual mark.
  substituted          — the name may be right, but the ICON IS A DIFFERENT DEVICE from the real logo's: a different symbol, or the same symbol in a different container SHAPE (a circle where the real one is a rounded square, a badge where the real one has none). Judge the icon on its own: if you covered the words, would the two emblems be recognisably the same drawing? If not, it is substituted.
  distorted            — recognisably the brand's mark but stretched, squashed, garbled or misspelled. THIS INCLUDES THE FINE TEXT AROUND OR INSIDE THE MARK: a badge or roundel usually carries small lettering on its rim (a strapline, a service list, a founding date). If that lettering is illegible, scrambled, mirrored, invented, or reads as letter-SHAPED marks rather than the real words, the mark is distorted — even when the central emblem and the business name are both perfect. Read the rim text in both images and compare it; say in the note what it should read and what it does read.
  recoloured-container — the brand's own container shape, drawn in a colour it does not have in the real logo.
  absent               — no mark and no business name anywhere.
  duplicated           — the mark appears more than once.

Compare the EMBLEM first and the words second. An invented emblem beside a correct business name is "substituted", not "correct" — the emblem is the part a reader recognises.

If in doubt between correct and anything else, answer correct.`;

/**
 * Turn a verdict into an instruction the next render can act on.
 *
 * The re-render loop feeds corrections back to the model, and a correction has
 * to say what to DO. "The logo is wrong" re-samples the same distribution;
 * "you set the business name in an ordinary font — reproduce the supplied logo
 * image exactly instead" is a different request.
 */
export function logoCorrection(judgement: LogoJudgement): string | null {
  switch (judgement.verdict) {
    case 'correct':
      return null;
    case 're-typeset':
      return 'the brand mark was RE-TYPESET — the business name was set in an ordinary font instead of the real logo. Reproduce the supplied LOGO image exactly as given: its letterforms, its icon, its proportions. Do not set the name in any font.';
    case 'substituted':
      return "the brand's icon was SUBSTITUTED — a different emblem or container shape was drawn instead of the real one. Reproduce the icon in the supplied LOGO image exactly: the same symbol, in the same container shape, or with no container at all. Do not invent a badge, circle, ring or motif the logo does not have.";
    case 'distorted':
      return 'the brand mark was DISTORTED — stretched, squashed or misspelled. Reproduce the supplied LOGO image at its true proportions, without altering its letterforms or spelling.';
    case 'recoloured-container':
      return 'the brand mark was placed on a container shape in a colour the real logo does not have. Reproduce the supplied LOGO image as given, or place the mark with no container at all.';
    case 'absent':
      return 'the brand mark is MISSING. Place the supplied LOGO image on the graphic, reproduced exactly as given.';
    case 'duplicated':
      return 'the brand mark appears MORE THAN ONCE. Show it exactly once.';
  }
}

/**
 * Stage 1: find the mark.
 *
 * The comparison used to be made on the WHOLE graphic downscaled to 900px, where
 * a mark that is ~100px wide on a 1080x1350 canvas ends up around 70px — about
 * 1% of the pixels — while the model is also asked to ignore a photograph, a
 * headline and a body block. It scored a substituted emblem (a circle of leaves
 * where the real mark is a butterfly in a rounded square) as correct.
 *
 * So locating comes first and judging second. Localisation is what a vision
 * model is reliably good at; fine comparison of two small drawings is not.
 */
const LOCATE_SYSTEM = `You are shown ONE generated social-media graphic for a business.

Find the BRAND MARK: the business's logo or wordmark — an icon, emblem, monogram or the business name set as a lockup. Do NOT count body copy, headlines, a plain-text website address or a social handle in the footer.

Return JSON only:
{ "count": <how many separate brand marks appear>,
  "box": { "x": <left>, "y": <top>, "w": <width>, "h": <height> } }

All four box values are FRACTIONS of the image, between 0 and 1, for the LARGEST/most prominent mark. Include the whole lockup — icon AND any business-name text set with it — plus a little breathing room. If count is 0, still return a box of zeros.`;

interface MarkLocation {
  count: number;
  box: { x: number; y: number; w: number; h: number };
}

function parseJson<T>(text: string): T | null {
  const json = extractJsonObject(text);
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

function textOf(message: {
  content: { type: string; text?: string }[];
}): string {
  return message.content
    .map((b) => (b.type === 'text' ? (b.text ?? '') : ''))
    .join('');
}

/**
 * Crop the mark out of the FULL-RESOLUTION png, with padding.
 *
 * Deliberately not from the downscaled copy: the whole point is to spend the
 * available pixels on the emblem. Returns null when the box is unusable, and
 * the caller then falls back to judging the whole graphic — a bad crop must
 * never leave us worse off than before.
 */
async function cropMark(
  png: Buffer,
  box: MarkLocation['box']
): Promise<Buffer | null> {
  try {
    const meta = await sharp(png).metadata();
    if (!meta.width || !meta.height) return null;

    const pad = 0.15;
    const left = Math.max(0, Math.round((box.x - box.w * pad) * meta.width));
    const top = Math.max(0, Math.round((box.y - box.h * pad) * meta.height));
    const width = Math.min(
      meta.width - left,
      Math.round(box.w * (1 + pad * 2) * meta.width)
    );
    const height = Math.min(
      meta.height - top,
      Math.round(box.h * (1 + pad * 2) * meta.height)
    );

    // A degenerate or absurd box means localisation failed. A crop that is
    // nearly the whole canvas is not a crop, and one a few pixels wide cannot
    // be judged.
    if (width < 24 || height < 24) return null;
    if (width > meta.width * 0.95 && height > meta.height * 0.95) return null;

    return await sharp(png)
      .extract({ left, top, width, height })
      .resize(MARK_MAX_EDGE, MARK_MAX_EDGE, {
        fit: 'inside',
        withoutEnlargement: false,
      })
      .jpeg({ quality: 92 })
      .toBuffer();
  } catch {
    return null;
  }
}

const judgeLogoImpl = async (
  input: JudgeLogoInput
): Promise<Result<LogoJudgement>> => {
  const parsed = judgeLogoSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { png, brandLogo } = parsed.data;

  const shrink = (b: Buffer, edge: number) =>
    sharp(b)
      .resize(edge, edge, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

  try {
    const [logoJpeg, graphicJpeg] = await Promise.all([
      shrink(brandLogo, LOGO_MAX_EDGE),
      shrink(png, GRAPHIC_MAX_EDGE),
    ]);

    const client = createAnthropicClient();

    const imagePart = (data: Buffer) => ({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: data.toString('base64'),
      },
    });

    // ── Stage 1: locate ────────────────────────────────────────────────
    const located = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 200,
      system: LOCATE_SYSTEM,
      messages: [{ role: 'user', content: [imagePart(graphicJpeg)] as never }],
    });
    const location = parseJson<MarkLocation>(textOf(located as never));

    // More than one lockup is a defect in itself, and cropping "the largest"
    // would hide the second.
    if (location && location.count > 1) {
      return ok({
        verdict: 'duplicated',
        note: `${location.count} separate brand marks`,
        isDefect: true,
        localisation: 'cropped',
      });
    }

    // ── Stage 2: compare ───────────────────────────────────────────────
    // Prefer the cropped mark. Fall back to the whole graphic whenever
    // localisation failed or produced an unusable box: judging at 1% of the
    // pixels is poor, but it is what this did before and it is better than
    // refusing to judge.
    const crop =
      location && location.count > 0 && location.box
        ? await cropMark(png, location.box)
        : null;
    const subject = crop ?? graphicJpeg;
    const localisation: LogoJudgement['localisation'] = crop
      ? 'cropped'
      : location && location.count === 0
        ? 'not-found'
        : 'fallback';

    const message = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 300,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: "The brand's REAL logo:" },
            imagePart(logoJpeg),
            {
              type: 'text',
              text: crop
                ? 'The mark as drawn on the generated graphic, cropped and enlarged:'
                : 'The generated graphic:',
            },
            imagePart(subject),
          ] as never,
        },
      ],
    });

    const reply = parseJson<{ verdict?: string; note?: string }>(
      textOf(message as never)
    );
    if (!reply) {
      return err(
        new FeatureError(ErrorCodes.INTERNAL_ERROR, 'No JSON in judge reply')
      );
    }

    // An unrecognised verdict is treated as `correct`, not as a defect. This
    // judgement triggers a re-render, and a parse slip must never cost a
    // second image call on a graphic that was fine.
    const verdict = (logoVerdictValues as string[]).includes(
      reply.verdict ?? ''
    )
      ? (reply.verdict as LogoVerdict)
      : 'correct';

    return ok({
      verdict,
      note: reply.note ?? '',
      isDefect: verdict !== 'correct',
      localisation,
    });
  } catch (error) {
    logError('imageGeneration.judgeLogo', error, {
      feature: 'image-generation',
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Logo judgement failed')
    );
  }
};

/**
 * Callers MUST fail open: an `err` here means "no opinion", not "reject".
 */
export const judgeLogo = (input: JudgeLogoInput) =>
  trackedResult('imageGeneration.judgeLogo', () => judgeLogoImpl(input));

export type JudgeLogoResult = Awaited<ReturnType<typeof judgeLogo>>;
