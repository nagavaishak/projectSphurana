import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import {
  type GraphicCategory,
  graphicCategoryValues,
} from '@borradh-workspace/api-client/types';
import { z } from 'zod';

/**
 * The generate-graphic form, declared ONCE — the choices the user makes on the
 * new-post-dialog's service step and in the standalone generate-graphic-dialog
 * (which the gallery/new wizard opens). Both surfaces render `labels.*` from
 * here and pass the resulting intent to the one `buildGenerateGraphicPayload`.
 *
 * See `@/lib/form-contract/define-form` for why the shape is this way.
 *
 * ONE CAVEAT, READ IT. This form is really a discriminated union on
 * `usageType`: an ORGANIC graphic chooses a `kind` (single / carousel) and has
 * no offer; a PAID AD picks an `offerId` and is always a single image, so the
 * format control isn't rendered at all. A BRANCH IS A SURFACE — the contract
 * models each (component × branch) pair as its own surface and declares what it
 * `owns`, so `kind` and `offerId` are each proven on the branch that renders
 * them, and neither has to be exempted away.
 */
export const generateGraphicForm = defineForm({
  fields: {
    usageType: {
      schema: z.enum(['organic', 'ad']),
      label: "What's this graphic for?",
      control: 'radio',
      default: 'organic',
      sample: 'organic',
      sampleLabel: 'Organic post',
    },
    serviceId: {
      // Both surfaces render a `role="combobox"` popover trigger, which takes
      // no accessible name from its content — the contract drives it by the
      // placeholder the user reads.
      schema: z.string().min(1, 'Pick a service'),
      label: 'Service',
      control: 'custom',
      default: '',
      sample: 'svc-1',
    },
    allowAiImages: {
      schema: z.boolean(),
      label: 'Use AI-generated images',
      control: 'switch',
      default: false,
      sample: true,
    },
    allowStockImages: {
      // Defaults ON — the curated stock tier fills slots the org has no photo
      // for. Both surfaces render this switch, so it is a first-class field
      // rather than a derived one.
      schema: z.boolean(),
      label: 'Use curated stock photos',
      control: 'switch',
      default: true,
      sample: false,
    },
    kind: {
      // new-post-dialog renders a radio pair, generate-graphic-dialog a Tabs
      // row — same choice, two control shapes, so the contract drives it.
      schema: z.enum(['single', 'carousel']),
      label: 'Format',
      control: 'custom',
      default: 'carousel',
      sample: 'single',
    },
    refinementInstruction: {
      schema: z.string().optional(),
      label: 'Any specific instructions? (optional)',
      control: 'textarea',
      default: '',
      sample: 'minimal style, bright colours',
    },
    offerId: {
      // Paid-ad branch only — same combobox shape as `serviceId`, so the
      // contract drives it by its placeholder too. A BRANCH IS A SURFACE: the
      // contract models (component × branch) pairs and each owns its slice, so
      // this needs no exemption.
      schema: z.string().optional(),
      label: 'Offer',
      control: 'custom',
      default: '',
      sample: 'offer-1',
    },
    category: {
      schema: z.custom<GraphicCategory>().optional(),
      default: graphicCategoryValues[0],
      exempt:
        'not user-editable by design: the editorial category is picked at random ' +
        'at submit ("the system picks for you"), and the server randomises ' +
        'further. Paid-ad graphics send none at all.',
    },
    topicSummary: {
      schema: z.string().optional(),
      default: '',
      exempt:
        'never set by a human surface — the server derives it from the service ' +
        'name. Only the Claire assistant tool (create-graphic.tool) supplies one.',
    },
  },
});

export const generateGraphicFormDefaults = generateGraphicForm.defaults;

export type GenerateGraphicFormValues = InferFormValues<
  typeof generateGraphicForm
>;

/**
 * Pick a random editorial category. Shared by both graphic surfaces, which used
 * to each keep their own copy of this. The server accepts any `graphicCategory`
 * and randomises further when needed, so we simply hand it one — matching the
 * "the system picks for you" UX.
 */
export function pickRandomGraphicCategory(): GraphicCategory | null {
  if (graphicCategoryValues.length === 0) return null;
  return (
    graphicCategoryValues[
      Math.floor(Math.random() * graphicCategoryValues.length)
    ] ?? null
  );
}
