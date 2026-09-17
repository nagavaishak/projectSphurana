/**
 * `verifyAssetDepictsService` — look at the photograph and say whether it shows
 * the service it is linked to.
 *
 * ## Why a second opinion exists
 *
 * Assets are linked to services by a tagging classifier that records its own
 * `confidence`. That number cannot catch its own mistakes. A coffee-scrub clip
 * was linked to "Deep Steam Facial 60 Mins" at 0.8 — the HIGHEST of the three
 * services it was tagged with — and the graphic built from it went out
 * describing an "aromatic coffee scrub" as part of the facial. The pool for
 * that service is one link at 0.9, eleven at 0.8 and eight below: there is no
 * threshold that keeps the good links and drops that one, because the
 * classifier was confident and wrong.
 *
 * Better tagging raises the hit rate and never removes this problem — any
 * classifier is wrong sometimes and cannot say which times. So this is
 * deliberately a DIFFERENT kind of evidence: the pixels, next to the service
 * name, judged by something that did not make the original decision.
 *
 * ## Why it is affordable
 *
 * The verdict is cached on the LINK, not recomputed per render. There are a
 * couple of thousand links across the estate, so verifying everything once
 * costs single-digit pounds, and a warm link costs nothing. Callers verify
 * lazily — only the asset a selection actually reaches.
 *
 * ## Failure behaviour is the point
 *
 * A "no" falls through to stock or AI, because a wrong photograph is a false
 * claim about the business while a generic one is merely generic. An ERROR
 * fails open and keeps the asset: a check that could not run is not evidence
 * against the image, and an observability layer must never become a new way to
 * block a render.
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
  type VerifyAssetDepictsServiceInput,
  verifyAssetDepictsServiceSchema,
} from './verify-asset-depicts-service.schema.js';

const VISION_MODEL = 'claude-sonnet-4-6';
/** Enough to recognise a treatment; this is not a fidelity judgement. */
const MAX_EDGE = 640;

export interface AssetDepictsVerdict {
  depicts: boolean;
  /** One short clause — what the image actually shows when it does not match. */
  note: string;
}

const SYSTEM = `You are shown ONE photograph taken by a beauty, aesthetics or wellness business, and told which of their services it is filed under.

Answer ONE question: could this photograph honestly illustrate a post about that service?

Return JSON only: { "depicts": true | false, "note": "<what the image actually shows, one short clause>" }

Say TRUE when the image shows that treatment being performed, its equipment, its immediate setting, its result, or the general environment of the business (a treatment room, a reception, a product shelf). A general or ambient photo is fine — it does not have to be a literal document of the procedure.

Say FALSE only when the image shows a DIFFERENT, identifiable treatment: a distinctly different procedure, a different modality, or a product or substance the named service does not involve. A photograph of one treatment used to advertise another is the failure this exists to catch — a graphic built from it describes what it can see, and states the wrong thing as fact.

When you cannot tell what treatment is happening, say TRUE. Ambiguity is not evidence of a mismatch, and a false negative throws away the business's own real photograph.`;

const verifyAssetDepictsServiceImpl = async (
  input: VerifyAssetDepictsServiceInput
): Promise<Result<AssetDepictsVerdict>> => {
  const parsed = verifyAssetDepictsServiceSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { image, serviceName, serviceDescription } = parsed.data;

  try {
    const small = await sharp(image)
      .resize(MAX_EDGE, MAX_EDGE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const client = createAnthropicClient();
    const message = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 200,
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: [
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
              // The description is included because a service name alone can be
              // opaque ("Princess Peel"), but it is context for the JUDGE only
              // and never reaches a render — see subjectContext.
              text: `This photograph is filed under the service: "${serviceName}"${
                serviceDescription
                  ? `\nService notes: ${serviceDescription}`
                  : ''
              }\n\nCould it honestly illustrate a post about that service?`,
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
        new FeatureError(ErrorCodes.INTERNAL_ERROR, 'No JSON in verify reply')
      );
    }
    const reply = JSON.parse(json) as {
      depicts?: unknown;
      note?: string;
    };

    // Anything that is not an explicit `false` counts as depicting. A parse
    // slip must never discard the business's own photograph.
    return ok({
      depicts: reply.depicts !== false,
      note: typeof reply.note === 'string' ? reply.note : '',
    });
  } catch (error) {
    logError('imageGeneration.verifyAssetDepictsService', error, {
      feature: 'image-generation',
    });
    return err(
      new FeatureError(ErrorCodes.INTERNAL_ERROR, 'Asset verification failed')
    );
  }
};

/**
 * Callers MUST fail open: an `err` means "no opinion", never "reject".
 */
export const verifyAssetDepictsService = (
  input: VerifyAssetDepictsServiceInput
) =>
  trackedResult('imageGeneration.verifyAssetDepictsService', () =>
    verifyAssetDepictsServiceImpl(input)
  );

export type VerifyAssetDepictsServiceResult = Awaited<
  ReturnType<typeof verifyAssetDepictsService>
>;
