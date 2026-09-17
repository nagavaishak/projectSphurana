/**
 * `listGraphicTemplates` — the styles a person (or Claire) may pick for a
 * graphic, for the generate-graphic dialog's picker and Claire's `style`.
 *
 * ## Organic work offers BRIEFS, not layouts
 *
 * The picker used to list composition templates for both kinds, and for
 * carousels that was already untrue: a brief superseded the pinned template
 * before the deck was built, so the choice was collected, stored, and ignored.
 * Organic entries are briefs now — a subject, not a layout — which is what
 * actually determines the post.
 *
 * Ads still list composition templates: an offer's price badge is pinned to a
 * region, so the layout genuinely is the choice being made.
 *
 * Pure registry read — no DB. Summaries carry only what a picker needs; the
 * brief prose and any layout internals stay server-side.
 */

import { trackedResult } from '@borradh-workspace/observability';
import {
  DECK_BRIEFS,
  SINGLE_BRIEFS,
  SINGLE_TEMPLATES,
} from '../../../image-generation/carousel-templates/index.js';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type ListGraphicTemplatesInput,
  listGraphicTemplatesSchema,
} from './list-graphic-templates.schema.js';

export interface GraphicTemplateSummary {
  slug: string;
  label: string;
  /** When this style fits — shown as helper text and fed to Claire. */
  description: string;
  kind: 'single' | 'carousel';
}

export interface ListGraphicTemplatesOutput {
  templates: GraphicTemplateSummary[];
}

const listGraphicTemplatesImpl = async (
  input: ListGraphicTemplatesInput
): Promise<Result<ListGraphicTemplatesOutput>> => {
  const parsed = listGraphicTemplatesSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { usageType } = parsed.data;

  const templates: GraphicTemplateSummary[] =
    usageType === 'ad'
      ? SINGLE_TEMPLATES.filter((t) => t.usageType === 'ad').map((t) => ({
          slug: t.slug,
          label: t.label,
          description: t.description,
          kind: 'single' as const,
        }))
      : [
          ...DECK_BRIEFS.map((b) => ({
            slug: b.slug,
            label: b.label,
            description: b.description,
            kind: 'carousel' as const,
          })),
          ...SINGLE_BRIEFS.map((b) => ({
            slug: b.slug,
            label: b.label,
            description: b.description,
            kind: 'single' as const,
          })),
        ];

  return ok({ templates });
};

export const listGraphicTemplates = (input: ListGraphicTemplatesInput = {}) =>
  trackedResult(
    'graphics.listGraphicTemplates',
    () => listGraphicTemplatesImpl(input),
    { properties: { usageType: input.usageType ?? 'organic' } }
  );

export type ListGraphicTemplatesResult = Awaited<
  ReturnType<typeof listGraphicTemplates>
>;
