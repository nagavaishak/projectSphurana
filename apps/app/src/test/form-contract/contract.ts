import type { FieldSpecMap, Form } from '@/lib/form-contract/define-form';
import type { UserEvent } from '@testing-library/user-event';

/**
 * One form's contract: everything the harness needs to prove that the form's
 * UI, its schema, and its payload agree.
 *
 * Most of what the old gates checked is no longer checkable, because
 * `defineForm` made it unspellable — a field cannot exist without a default, a
 * label, or a place in the schema. What is left is the part no compiler can see:
 *
 *   1. DEFAULTS COMPLETE — re-checked at runtime as a backstop, in case a form
 *      reaches `useForm` with defaults built some other way.
 *   2. FIELDS REACHABLE  — every declared field has a control ON SCREEN.
 *   3. PAYLOAD CORRECT   — a full fill produces exactly the expected body.
 *   4. SURFACES AGREE    — every surface builds the same body from that fill.
 */
export interface FormContract<F extends FieldSpecMap, V extends object> {
  /** Normalised endpoint, e.g. `POST social-posts`. Must match the registry. */
  operation: string;
  /** One line, for the test name. */
  description: string;

  /**
   * The form definition — schema, defaults and fields all come from here.
   *
   * `null` ONLY for an operation with no user-facing form at all: a body built
   * from `window.location` (the Stripe account link), or from a row the user
   * clicked rather than fields they filled. Then `noForm` must say so, properties
   * 1 and 2 have nothing to check, and 3 and 4 still do — the surfaces still have
   * to build the same, correct body. It is not an escape hatch for a form that
   * is merely awkward to drive; `coverage.test.ts` counts these and holds the
   * number down.
   */
  form: Form<F, V> | null;
  /** Required when `form` is null: why this operation has no form. */
  noForm?: string;

  /** The surfaces that build this operation's body. Two or more = parity. */
  surfaces: Surface<F>[];

  /**
   * How the harness drives the controls it cannot drive generically — anything
   * declared `control: 'custom'` (an asset grid, a colour swatch, a calendar
   * drag). A `'custom'` field with no entry here is a hard failure, not a skip.
   */
  fills?: Partial<Record<keyof F, (user: UserEvent) => Promise<void>>>;

  /**
   * The operation's shared payload builder, for PROPERTY 5 (minimum fill).
   *
   * Properties 2–4 drive the UI with every field filled. That is the shape a
   * test writer produces and very nearly the only shape the suite has ever
   * seen — but it is not the shape most users submit. They fill what is
   * required and leave the rest blank, and an untouched text input holds `''`,
   * not `undefined`.
   *
   * `''` is a PRESENT value, so an API field typed `z.string().email().optional()`
   * accepts an absent key and rejects an empty one. `POST /leads` shipped that
   * way: every client added without an email address was refused with a bare
   * "Validation failed" naming no field, and no amount of full-fill testing
   * could see it.
   *
   * Given the builder, the harness can check this without driving anything —
   * it derives the minimum values from the form's own schema. Omit it only
   * while an operation is being migrated; the harness reports what it skipped.
   */
  buildBody?: (values: V) => Record<string, unknown>;

  /** Reads the request body from the mocked `apiClient`. Throws if there is none. */
  readBody: () => Record<string, unknown>;
  /** Clears the `apiClient` mock between surfaces. */
  reset: () => void;

  /**
   * The exact body a full fill must produce. Build it with `expectedFromFields`
   * so it is derived from the same samples the harness types in — a hand-written
   * expectation is one more thing that can drift.
   *
   * Called with the surface being driven, so a PATCH operation whose surfaces own
   * different slices can narrow the expectation to that slice:
   * `(s) => expectedFromFields(form.fields, {}, { only: s.owns })`.
   */
  expectedBody: (surface: Surface<F>) => Record<string, unknown>;
}

/** A UI that builds this operation's request body. */
export interface Surface<F extends FieldSpecMap> {
  /** Shown in the test name, e.g. `desktop dialog`. */
  name: string;
  /**
   * The fields THIS surface is responsible for, when the operation is a PATCH
   * whose surfaces each own a different slice of the entity.
   *
   * Omit it for a create/replace: the surface then owns every field, and the
   * harness requires it to fill all of them — two surfaces of a "create lead"
   * that render different fields are simply drifting.
   *
   * But `PATCH organization` is written by six forms sharing one endpoint: the
   * details page owns name/websiteUrl/privacyPolicyUrl, the bookings tab owns
   * the deposit and notice-period policy, the style page owns the logo and brand
   * colours. `buildUpdateOrganizationPayload` emits only the keys present on the
   * intent, precisely so each surface patches what it owns. Demanding that the
   * style page render the deposit policy would be a product change, and
   * exempting the fields each surface lacks would gut the very check that catches
   * a deleted control.
   *
   * So ownership is declared, and the harness holds the line that matters:
   *   - every field must be owned by AT LEAST ONE surface (nothing may become
   *     unreachable everywhere — that is still the dropped-field bug); and
   *   - where two surfaces own the SAME field, they must still agree on it.
   *
   * Two idioms fall out of this:
   *
   *   `owns: []` — a FIELD-LESS surface of a form-ful operation. The calendar
   *   drag-drop reaches `buildUpdateSocialPostPayload` with nothing to fill: it
   *   just hands it an ISO instant. It fills nothing, and its body is still
   *   asserted by property 3 via `expectedBody(surface)`.
   *
   *   A BRANCH IS A SURFACE. `POST graphics/generate` is a union on `usageType`:
   *   organic renders a `kind` control and no offer, a paid ad renders an
   *   `offerId` and no format. Declare `'new-post-dialog (organic)'` and
   *   `'new-post-dialog (paid ad)'` as two surfaces owning their own slices,
   *   rather than exempting whichever fields the branch you happened to test does
   *   not render — an exemption there would hide a dropped control.
   */
  owns?: (keyof F & string)[];
  /**
   * Fills that are specific to THIS surface, overriding the contract-level
   * `fills`. Two surfaces often reach the same field through different controls —
   * the category dialog has a labelled Name input, while the picker's create-row
   * IS the combobox search box. Both still locate a real control and still throw
   * when it is missing; they just aren't the same control.
   */
  fills?: Partial<Record<keyof F, (user: UserEvent) => Promise<void>>>;
  /**
   * Mount the surface and drive it to submit, calling `fill` at the points where
   * each field becomes reachable (a wizard fills between steps). The harness
   * checks afterwards that every field this surface OWNS was filled — a step you
   * forgot to walk is itself a failure, because an unfilled field is an unproven
   * one.
   */
  run: (ctx: SurfaceContext<F>) => Promise<void>;
}

export interface SurfaceContext<F extends FieldSpecMap> {
  user: UserEvent;
  /** Fill these fields now. Throws loudly if a control is not on screen. */
  fill: (...keys: (keyof F & string)[]) => Promise<void>;
  /** Fill every declared field not yet filled. */
  fillRest: () => Promise<void>;
}
