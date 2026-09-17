/**
 * `inspectGraphic` — look at a finished graphic before the owner does.
 *
 * Generation is judged today by whether the job succeeded, not by whether the
 * image is right. So these ship:
 *
 *   - duplicated or garbled text. A real production deck rendered
 *     "First, we assess your skin — properly. skin — properly."
 *   - literal markdown left in the rendered words — `*Powder Brows*`,
 *     `*Microneedling — BeYOUtiful GLOW*`. Seen three times in one session's
 *     sampling, and it compounds: customers publish these, we ingest their
 *     published posts as brand inspiration, and the defect comes back as "the
 *     brand style". The ingest gate rejects it on the way in; this rejects it
 *     on the way out, which is the cheaper of the two places to catch it.
 *   - misspellings, and text clipped by the canvas edge or overlapping
 *   - a missing, distorted or duplicated logo
 *   - invented people presented as real clients — in particular a fabricated
 *     before/after pair, which is a claim about treatment results
 *   - Instagram chrome copied from a reference: pagination dots, "SWIPE"
 *
 * Every one is obvious to a human in a second and invisible to the pipeline. In
 * a 42-image trial this caught four text defects a careful human review of the
 * same images had missed, including `talented talented` and a client's name
 * misspelt.
 *
 * DELIBERATELY CONSERVATIVE. A gate that flags everything gets switched off, so
 * the prompt demands a specific, locatable defect and treats stylistic opinions
 * as a pass. The number that matters is not how many defects it finds but how
 * many CLEAN graphics it wrongly fails.
 *
 * One vision call per render, a few tenths of a penny against a graphic that
 * otherwise reaches the owner broken.
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
  type GraphicDefect,
  type InspectGraphicInput,
  inspectGraphicSchema,
} from './inspect-graphic.schema.js';

const VISION_MODEL = 'claude-sonnet-4-6';
/** Enough to read rendered copy; more would just cost tokens. */
const INSPECT_MAX_EDGE = 900;

/**
 * JSON mode is an API-enforced contract, not a prompt suggestion.
 *
 * The quality gate previously asked for JSON in natural language and then
 * parsed the resulting text itself. A malformed model response (the Sentry
 * `API-FB` event) therefore raised a `SyntaxError` inside `runQualityGate`'s
 * call stack. The gate fails open by design, but a malformed *transport
 * format* is neither a graphic defect nor an application fault worth paging
 * for. More importantly, parsing the model's prose is the wrong boundary:
 * the provider already supports constrained JSON output.
 *
 * Keep this schema deliberately small and permissive about free-text defect
 * detail. The code below remains responsible for applying product policy and
 * filtering unexpected-but-valid values; this only guarantees syntactically
 * valid JSON with the shape the model is asked to return.
 */
const INSPECTION_OUTPUT_FORMAT = {
  type: 'json_schema' as const,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['pass', 'issues'],
    properties: {
      pass: { type: 'boolean' },
      issues: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['severity', 'kind', 'detail'],
          properties: {
            severity: { type: 'string', enum: ['blocker', 'warning'] },
            kind: { type: 'string' },
            detail: { type: 'string' },
          },
        },
      },
    },
  },
};

export interface GraphicInspection {
  pass: boolean;
  defects: GraphicDefect[];
  blockers: GraphicDefect[];
  /**
   * What the gate saw, BEFORE any imagery-policy downgrade. Identical inputs
   * produce an identical `observed` list whatever the org's imagery settings
   * are, which is what makes two configurations comparable — `blockers` is not,
   * by design, because policy has been applied to it.
   */
  observed: GraphicDefect[];
}

function normaliseKind(kind: string): string {
  return kind.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * Apply the org's imagery choice to an INVARIANT observation.
 *
 * An org that opted into AI imagery has chosen to publish invented people, so
 * their presence is not something an owner would refuse to publish — it drops
 * to a warning. It is NOT dropped: it stays in the list, because "this deck is
 * full of invented faces" is worth seeing even when it was asked for.
 *
 * A fabricated BEFORE/AFTER pair is never downgraded. That asserts a result the
 * business did not produce, which no setting makes acceptable.
 *
 * Neither is a fabricated PRODUCT, for the same reason. Opting into AI imagery
 * is permission to invent a SCENE — a plausible treatment room, a plausible
 * client — not permission to invent a product line and put the business's name
 * on it. Only `invented-people` is listed below, so anything added here is
 * blocker-preserving by default; that is the intended direction.
 */
export function applyImageryPolicy(
  defects: GraphicDefect[],
  allowAiImages: boolean
): GraphicDefect[] {
  if (!allowAiImages) return defects;
  return defects.map((d) =>
    normaliseKind(d.kind) === DEFECT_KIND_INVENTED_PEOPLE
      ? { ...d, severity: 'warning' as const }
      : d
  );
}

/**
 * Slugs the gate is required to use for the two imagery findings, so the
 * POLICY filter below can act on them in code. Everything else stays
 * free-text.
 */
export const DEFECT_KIND_INVENTED_PEOPLE = 'invented-people';
export const DEFECT_KIND_FABRICATED_BEFORE_AFTER = 'fabricated-before-after';
/**
 * An invented PRODUCT carrying the business's name.
 *
 * The checklist covered invented people and never invented merchandise, so a
 * slide that drew a gold serum bottle labelled with the org's service name —
 * for a business that sells treatments and has no product line — passed
 * cleanly. It is the same class of fault as a fabricated before/after: the
 * graphic asserts something the business does not have, in its own name, and
 * an owner cannot publish it.
 *
 * Deliberately narrow. Generic props in shot — a bottle on a shelf, a towel, a
 * candle — are set dressing and are not defects. It is the BRANDING of an
 * invented product that makes the claim.
 */
export const DEFECT_KIND_FABRICATED_PRODUCT = 'fabricated-product';

function buildSystemPrompt(hasBrandLogo: boolean, expectLogo: boolean): string {
  // ONE rulebook, always. This prompt deliberately does NOT vary with the
  // org's imagery settings.
  //
  // It used to: with `allowAiImages` set, the "AI-generated people" rule was
  // swapped out entirely. That made the gate score two different things
  // depending on a config flag, so an AI-on render and an AI-off render were
  // never comparable — turning the flag on bought a lower blocker count for
  // free, and an output that visibly worsened was nearly reported as "no
  // change". Whether an invented person is ACCEPTABLE is a product decision;
  // whether one is PRESENT is an observation. The observation happens here and
  // is invariant; the decision happens in `applyImageryPolicy` below.
  const peopleRule = `- people presented as real clients or staff who are clearly AI-generated. Use kind "${DEFECT_KIND_INVENTED_PEOPLE}"
- a BEFORE/AFTER pair showing two different people, or otherwise implying a treatment result that was not actually achieved. Use kind "${DEFECT_KIND_FABRICATED_BEFORE_AFTER}"
- a PRODUCT that carries the business's name or a service name as if it were merchandise the business sells — a labelled bottle, jar, tube, box, pouch or device. Report it only when the branding is on the product itself; unbranded props in shot (a plain bottle on a shelf, a towel, a candle) are set dressing, not a defect. Use kind "${DEFECT_KIND_FABRICATED_PRODUCT}"`;

  return `You are the final check before a generated social-media graphic is shown to the business owner who will publish it. Report only DEFECTS — concrete, locatable faults a reasonable person would call broken or misleading. Taste, layout preferences and copy quality are NOT defects.

Look for:
- text that is duplicated, repeated, garbled, misspelled, or cut off by the edge of the canvas
- LITERAL MARKDOWN OR FORMATTING CHARACTERS rendered as part of the words: *asterisks*, _underscores_, \`backticks\`, ## hashes. The copy is authored in plain text, so a visible asterisk means the renderer drew a formatting mark instead of applying it — always a defect, never a design choice
- text overlapping other text or a logo so either becomes hard to read
${
  expectLogo
    ? '- a logo that is missing, distorted, stretched, or appears more than once'
    : '- ANY brand mark, logo, monogram, emblem or badge at all. This graphic is meant to carry NO branding — a plain-text handle or website address in the footer is fine, a drawn mark is a defect. Do NOT report a missing logo here; its absence is correct.'
}${
  hasBrandLogo && expectLogo
    ? `
- the brand's mark RE-TYPESET: the business name set in an ordinary font where the real logo should be, instead of the actual lockup. The FIRST image is the brand's real logo — compare against it. A different size, placement or colourway of the same mark is fine, and so is the mark without its container shape; brands use several lockups. Only report it when the letterforms are plainly not the brand's.`
    : ''
}
- a hashtag or handle containing a space, or otherwise malformed
${peopleRule}
- social-media interface chrome, drawn OR written. Icons: pagination dots, swipe arrows, like/comment/share icons, another account's watermark. WORDS, which count even when set as ordinary body copy in the brand's own typeface: "swipe", "swipe up", "swipe through", "tap", "link in bio", "vote", "comment below", "share this", "follow us". A sentence like "Swipe through to find out" is chrome — the graphic is read on its own and there is nothing to swipe to

Return JSON only:
{ "pass": <true if you found NO defect>,
  "issues": [ { "severity": "blocker" | "warning", "kind": "<short slug>", "detail": "<what and where, quoting the text if it is a text fault>" } ] }

"blocker" = an owner would refuse to publish it. "warning" = noticeable but publishable. If in doubt, do not report it.`;
}

const inspectGraphicImpl = async (
  input: InspectGraphicInput
): Promise<Result<GraphicInspection>> => {
  const parsed = inspectGraphicSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { png, allowAiImages, slideOrder, brandLogo, expectLogo } = parsed.data;

  try {
    const small = await sharp(png)
      .resize(INSPECT_MAX_EDGE, INSPECT_MAX_EDGE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88 })
      .toBuffer();

    const client = createAnthropicClient();
    const message = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 800,
      output_config: { format: INSPECTION_OUTPUT_FORMAT },
      system: buildSystemPrompt(Boolean(brandLogo) && expectLogo, expectLogo),
      messages: [
        {
          role: 'user',
          content: [
            ...(brandLogo
              ? [
                  {
                    type: 'text',
                    text: "The brand's real logo, for comparison:",
                  },
                  {
                    type: 'image',
                    source: {
                      type: 'base64',
                      media_type: 'image/jpeg',
                      data: (
                        await sharp(brandLogo)
                          .resize(400, 400, {
                            fit: 'inside',
                            withoutEnlargement: true,
                          })
                          .jpeg({ quality: 85 })
                          .toBuffer()
                      ).toString('base64'),
                    },
                  },
                  { type: 'text', text: 'The generated graphic:' },
                ]
              : []),
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: small.toString('base64'),
              },
            },
            {
              type: 'text',
              text:
                slideOrder === undefined
                  ? 'Check this graphic.'
                  : `Check this graphic (slide ${slideOrder + 1} of a carousel).`,
            },
          ] as never,
        },
      ],
    });

    const text = message.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');
    const json = extractJsonObject(text);
    if (!json) {
      return err(
        new FeatureError(ErrorCodes.INTERNAL_ERROR, 'No JSON in gate reply')
      );
    }
    const verdict = JSON.parse(json) as {
      pass?: boolean;
      issues?: GraphicDefect[];
    };

    const observed = (verdict.issues ?? []).filter(
      (d): d is GraphicDefect =>
        Boolean(d?.detail) &&
        Boolean(d?.kind) &&
        (d.severity === 'blocker' || d.severity === 'warning')
    );
    // The gate observed; policy now decides what an owner would refuse.
    const defects = applyImageryPolicy(observed, allowAiImages);
    const blockers = defects.filter((d) => d.severity === 'blocker');

    // `pass` is derived, not taken from the model: a reply claiming
    // `pass: true` alongside a blocker is self-contradictory, and the issues
    // list is the load-bearing half.
    return ok({ pass: blockers.length === 0, defects, blockers, observed });
  } catch (error) {
    logError('imageGeneration.inspectGraphic', error, {
      feature: 'image-generation',
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Graphic inspection failed')
    );
  }
};

/**
 * Callers MUST fail open: an inspection that could not run is not a failed
 * render, and an observability layer must never be able to block the pipeline.
 * Hence `Result` — an `err` here means "no opinion", not "reject".
 */
export const inspectGraphic = (input: InspectGraphicInput) =>
  trackedResult('imageGeneration.inspectGraphic', () =>
    inspectGraphicImpl(input)
  );

export type InspectGraphicResult = Awaited<ReturnType<typeof inspectGraphic>>;
