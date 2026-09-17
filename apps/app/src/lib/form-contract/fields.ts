/**
 * THE FIELD REGISTRY — production code, pure data.
 *
 * One entry per key of a form's values, declared once and consumed by BOTH the
 * component (which renders `fields.phone.label`) and the form-contract harness
 * (which locates the control by that same label and fills it with `sample`).
 *
 * This is the structural half of the form contract. `defineFields<V>()` is typed
 * `Record<keyof V, FieldEntry>`, so a key that exists in the form's values — and
 * therefore in its schema and in its payload builder — CANNOT be missing here.
 * TypeScript rejects the file.
 *
 * That closes the hole the old payload-level tests could not see. The
 * team-member editor's Phone / Country code / Additional phone inputs were
 * deleted from the JSX while `phone` / `phoneCountry` / `phoneSecondary` stayed
 * in the schema AND in `create-team-member.payload.ts`. Every test stayed green:
 * the builder still mapped the fields, both surfaces shared the same (broken)
 * panel so parity still held, and the test recipes simply did not know the
 * fields existed — because each recipe was hand-written, and a hand-written list
 * can silently omit the very field that was dropped. This one cannot.
 *
 * The registry also SINGLE-SOURCES THE LABEL. The component renders
 * `fields.phone.label`; the harness locates with the same string. They cannot
 * drift, and when the input is deleted from the JSX the harness finds nothing
 * and reports "field unreachable". Compile-time owns "the field is declared";
 * the harness owns "the field is on screen". Between them a dropped field has
 * nowhere to hide.
 *
 * Keep this file free of test imports — it ships.
 */

/**
 * The control kinds the harness can drive generically. A field whose UI is
 * bespoke (an asset picker, a colour grid, a drag-and-drop calendar) declares
 * `control: 'custom'` and the contract spec supplies a `fill` override.
 */
export type ControlKind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'email'
  | 'tel'
  | 'date'
  | 'time'
  | 'select'
  | 'combobox'
  | 'checkbox'
  | 'switch'
  | 'radio'
  | 'tags'
  | 'custom';

export interface FieldMeta<T = unknown> {
  /**
   * The visible label. The component MUST render this exact string (via
   * `fields.x.label`) — it is the harness's locator.
   */
  label: string;
  /** How the harness drives the control. `'custom'` requires a spec override. */
  control: ControlKind;
  /**
   * The value the harness fills in, and — unless the contract says otherwise —
   * the value it then expects in the request body. Keeping the recipe and the
   * assertion on one line is what stops them drifting apart.
   */
  sample: T;
  /**
   * The VISIBLE text of the option to pick, when it differs from the value that
   * reaches the form (a `select` whose option reads "Walk-in" but whose value is
   * `walk_in`). Only meaningful for select / combobox / radio.
   */
  sampleLabel?: string;
  /**
   * Set when the value the user types is not the value that reaches the wire
   * (a `'14:30'` time folded into a `scheduledAt` ISO string, a `'12.50'` price
   * sent as `1250` cents). The harness then does not expect `sample` in the body
   * — the contract's `expectedBody` spells the derived value out.
   */
  derived?: boolean;
}

/**
 * A field the user deliberately cannot edit — a server-derived id, a value
 * carried in from the surface's props, a mode discriminator flipped by a tab.
 *
 * Exempting requires a reason, and a human reads that reason in review. If the
 * harness reports a field unreachable and the honest answer is "the control
 * really is gone", that is A BUG TO FIX, not a field to exempt.
 */
export interface ExemptField {
  readonly exempt: true;
  why: string;
}

export type FieldEntry = FieldMeta | ExemptField;

export const exempt = (why: string): ExemptField => ({ exempt: true, why });

export const isExempt = (entry: FieldEntry): entry is ExemptField =>
  (entry as ExemptField).exempt === true;

/** Narrowing helper so `field.label` typechecks after an `isExempt` guard. */
export const isField = (entry: FieldEntry): entry is FieldMeta =>
  !isExempt(entry);

/**
 * Declare a form's field registry.
 *
 * Curried so `V` is given explicitly while the map's literal types are still
 * inferred: `defineFields<CreateLeadFormValues>()({ firstName: {...}, … })`.
 * Every key of `V` must appear — as a `FieldMeta` (the user can produce it) or
 * an `exempt(why)` (they deliberately cannot).
 */
export const defineFields =
  <V extends object>() =>
  <M extends Record<keyof V, FieldEntry>>(map: M): M =>
    map;

/** The entries the harness must reach and fill, in declaration order. */
export const fillableFields = (
  fields: Record<string, FieldEntry>
): [string, FieldMeta][] =>
  Object.entries(fields).filter((e): e is [string, FieldMeta] => isField(e[1]));

/**
 * The body a full fill should produce, built from the registry's own samples so
 * the recipe and the assertion cannot drift. `derived` fields are left out —
 * the contract supplies their wire value via `extra`.
 */
export const expectedFromFields = (
  fields: Record<string, FieldEntry>,
  extra: Record<string, unknown> = {},
  options:
    | string[]
    | {
        /** Drop these keys (the builder omits them, or folds them into `extra`). */
        omit?: string[];
        /**
         * Keep ONLY these keys — the slice a PATCH surface owns. `PATCH
         * organization` is written by six forms sharing one endpoint, and the
         * builder emits only the keys present on the intent, so the bookings
         * tab's body legitimately carries nothing of the style page's.
         */
        only?: string[];
      } = {}
): Record<string, unknown> => {
  // A bare array is shorthand for `{ omit }`.
  const { omit = [], only } = Array.isArray(options)
    ? { omit: options }
    : options;
  const body: Record<string, unknown> = {};
  for (const [key, entry] of fillableFields(fields)) {
    if (entry.derived || omit.includes(key)) continue;
    if (only && !only.includes(key)) continue;
    body[key] = entry.sample;
  }
  return { ...body, ...extra };
};
