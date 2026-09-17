import { z } from 'zod';

import type { ControlKind, FieldEntry, FieldMeta } from './fields';
import { exempt } from './fields';

/**
 * ONE declaration per field. The schema, the default, the label and the control
 * live on the same line, and everything else is derived from them.
 *
 *   export const createLeadForm = defineForm({
 *     fields: {
 *       firstName: { schema: z.string().min(1, 'First name is required'),
 *                    label: 'First Name *', control: 'text',
 *                    default: '', sample: 'Ada' },
 *       consentSms: { schema: z.boolean().optional(),
 *                     label: 'SMS', control: 'checkbox',
 *                     default: false, sample: true },
 *     },
 *   });
 *
 *   createLeadForm.schema     // → zodResolver(...)
 *   createLeadForm.defaults   // → useForm({ defaultValues })
 *   createLeadForm.fields     // → the JSX renders fields.consentSms.label
 *   type Values = InferFormValues<typeof createLeadForm>;
 *
 * WHY THIS SHAPE. A form used to be three or four separately hand-authored
 * artifacts — a schema, a values type, a defaults literal, a payload builder,
 * and the JSX — with nothing structurally binding them. Every CI gate this
 * replaces existed to detect a drift between them after the fact. Here a key
 * exists in exactly one place, so the drift is not detected, it is unspellable:
 *
 *   - A field CANNOT be declared without a default. `default` is a required
 *     property, and its type excludes `undefined`. That is property 1
 *     ("defaults complete") retired — it is no longer a thing that can be got
 *     wrong. It is how `PostContentDialog` shipped a form whose `date`/`time`
 *     were absent from `defaultValues`, so submit sent `undefined` and zod
 *     reported "expected string, received undefined" against fields the user
 *     could see were filled in.
 *
 *   - A field cannot be declared without a label, and the component renders that
 *     label rather than a string of its own. The harness locates the control by
 *     the same label, so the two cannot drift — and when the control is deleted
 *     from the JSX, the harness finds nothing and fails. That is property 2
 *     ("fields reachable"), the one thing here a compiler genuinely cannot see:
 *     the type system can prove the field is DECLARED, only a render can prove
 *     it is ON SCREEN. It is how the team-member editor's Phone / Country code /
 *     Additional phone inputs were deleted while the schema and the payload
 *     builder kept the fields, and every payload-level test stayed green.
 *
 * The payload builder deliberately stays a separate function: the wire body is a
 * genuinely different shape ('12.50' → 1250 cents; three consent booleans → one
 * derived consentSource), and that is a mapping, not a restatement. But its
 * input type is derived from this declaration, so a field removed here breaks
 * the builder at compile time instead of silently.
 */

/** A field the user can see and edit. */
export interface EditableFieldSpec<S extends z.ZodTypeAny = z.ZodTypeAny> {
  schema: S;
  /** Rendered by the component (`fields.x.label`) AND used as the harness's locator. */
  label: string;
  control: ControlKind;
  /**
   * The seed value. REQUIRED, and `undefined` is not assignable — a field cannot
   * exist without a default. An empty required field ('' / []) is fine and
   * normal: it renders an actionable "is required" error. An ABSENT one is the
   * bug — react-hook-form holds no state for it and submit sends `undefined`.
   */
  default: Exclude<z.input<S>, undefined>;
  /** What the harness types in. Defaults to `default` when the field is trivial. */
  sample?: z.input<S>;
  /**
   * The VISIBLE text of the option to pick, when it differs from the value the
   * form stores (a `select` whose option reads "Walk-in" for the value
   * `walk_in`). Only meaningful for select / combobox / radio.
   */
  sampleLabel?: string;
  /**
   * Set when the value the user enters is not the value that reaches the wire
   * (a '14:30' folded into a `scheduledAt` ISO string). The harness then does
   * not expect `sample` in the body; the contract's `expectedBody` says what to.
   */
  derived?: boolean;
}

/** A field the user deliberately cannot edit. Still needs a schema and a default. */
export interface ExemptFieldSpec<S extends z.ZodTypeAny = z.ZodTypeAny> {
  schema: S;
  default: Exclude<z.input<S>, undefined>;
  /** Why the user cannot (and should not) reach this field. Read in review. */
  exempt: string;
}

export type FieldSpec<S extends z.ZodTypeAny = z.ZodTypeAny> =
  | EditableFieldSpec<S>
  | ExemptFieldSpec<S>;

export type FieldSpecMap = Record<string, FieldSpec>;

const isExemptSpec = (spec: FieldSpec): spec is ExemptFieldSpec =>
  'exempt' in spec;

/**
 * A discriminated union of form shapes — the `mode: 'now' | 'schedule'` case.
 *
 * Modelled explicitly rather than flattened, because it is the exact shape that
 * produced the original bug: `date` is optional while the form sits in `'now'`
 * and required once the user picks `'schedule'`, so a plain parse of the
 * defaults in the starting branch sees nothing wrong. Here every field carries a
 * default regardless of which branch requires it, so the trap is closed by
 * construction.
 */
export interface VariantSpec<F extends FieldSpecMap> {
  /** The discriminator key. Must itself be a field (usually `exempt`). */
  on: keyof F & string;
  /**
   * One entry per branch. `optional` lists the fields that branch does NOT
   * require — they keep their default and their control either way.
   */
  cases: Record<string, { optional?: (keyof F & string)[] }>;
}

export interface FormDefinition<F extends FieldSpecMap> {
  fields: F;
  variants?: VariantSpec<F>;
}

/** The form's value type, derived from the per-field schemas. */
export type InferFormValues<T> = T extends { __values: infer V } ? V : never;

export interface Form<F extends FieldSpecMap, V> {
  /** The zod schema — hand to `zodResolver`. */
  schema: z.ZodType<V, V>;
  /** The seeded defaults — hand to `useForm({ defaultValues })`. */
  defaults: V;
  /** Label + control + sample per key — the JSX and the harness both read this. */
  fields: Record<keyof F, FieldEntry>;
  /**
   * Just the labels, for the JSX: `<FormLabel>{form.labels.phone}</FormLabel>`.
   *
   * Rendering the label from here rather than as a literal is what ties the
   * component to the declaration. The harness locates the control by this same
   * string, so the two cannot drift — and deleting the control from the JSX,
   * which no compiler can see, is exactly what the harness then catches.
   */
  labels: Record<keyof F, string>;
  /** The raw specs, for anything that needs the per-field schema. */
  specs: F;
  /** Phantom, carries the value type for `InferFormValues`. */
  __values: V;
}

type ValuesOf<F extends FieldSpecMap> = {
  [K in keyof F]: z.infer<F[K]['schema']>;
};

/** Make a field schema optional for a branch that doesn't require it. */
const relax = (schema: z.ZodTypeAny): z.ZodTypeAny =>
  schema.optional() as z.ZodTypeAny;

export function defineForm<F extends FieldSpecMap>(
  definition: FormDefinition<F>
): Form<F, ValuesOf<F>> {
  const { fields: specs, variants } = definition;

  // ---- defaults: every field, no exceptions. This is property 1, structurally.
  const defaults = Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => [key, spec.default])
  ) as ValuesOf<F>;

  // ---- schema
  const shape = Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => [key, spec.schema])
  );

  let schema: z.ZodTypeAny;
  if (variants) {
    const branches = Object.entries(variants.cases).map(([caseName, cfg]) => {
      const branchShape: Record<string, z.ZodTypeAny> = { ...shape };
      for (const key of cfg.optional ?? []) {
        branchShape[key] = relax(shape[key]);
      }
      // The discriminator is pinned to this branch's literal.
      branchShape[variants.on] = z.literal(caseName);
      return z.object(branchShape);
    });
    if (branches.length < 2) {
      throw new Error('defineForm: variants need at least two cases');
    }
    schema = z.discriminatedUnion(
      variants.on,
      branches as unknown as [z.ZodObject, ...z.ZodObject[]]
    );
  } else {
    schema = z.object(shape);
  }

  // ---- the label/control view the JSX and the harness share
  const fields = Object.fromEntries(
    Object.entries(specs).map(([key, spec]): [string, FieldEntry] => {
      if (isExemptSpec(spec)) return [key, exempt(spec.exempt)];
      const meta: FieldMeta = {
        label: spec.label,
        control: spec.control,
        sample: 'sample' in spec ? spec.sample : spec.default,
        sampleLabel: spec.sampleLabel,
        derived: spec.derived,
      };
      return [key, meta];
    })
  ) as Record<keyof F, FieldEntry>;

  const labels = Object.fromEntries(
    Object.entries(specs).map(([key, spec]) => [
      key,
      isExemptSpec(spec) ? '' : spec.label,
    ])
  ) as Record<keyof F, string>;

  return {
    schema: schema as unknown as z.ZodType<ValuesOf<F>, ValuesOf<F>>,
    defaults,
    fields,
    labels,
    specs,
    __values: undefined as never,
  };
}
