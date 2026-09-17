import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { offerDiscountTypeLabels } from '@borradh-workspace/api-client/types';
import { z } from 'zod';

/**
 * The offer (promotion) form, declared ONCE.
 *
 * Every key carries its schema, its label, its control and its default on one
 * line; the zod schema, the `defaultValues` and the labels the dialog renders
 * are all derived from it. The dialog hands typed intent (euros, `Date`s) to
 * `buildCreateOfferPayload` / `buildUpdateOfferPayload`, which own euro→cents,
 * date→ISO and the discount-type-conditional nulling — so most numeric fields
 * are `derived`: what the user types is not what reaches the wire.
 *
 * ── The discount shapes are BRANCHES, and a branch is a SURFACE ─────────────
 * Which numeric inputs the dialog renders is discriminated by `discountType`:
 * percentage shows one field, fixed-amount another, and the legacy `fixed_price`
 * / `buy_x_get_y` shapes show theirs only while editing an offer that ALREADY
 * uses them (`visibleDiscountTypes` hides legacy types from the create flow).
 *
 * No field is exempted for that. Each branch is declared as its own surface in
 * `offer.contract.test.tsx` — seeded with an offer of that shape — so every
 * input is owned by some surface, and deleting any of them fails the contract.
 *
 * See `@/lib/form-contract/define-form` for why the shape is this way.
 */
export const offerForm = defineForm({
  fields: {
    name: {
      schema: z.string().min(1, 'Name is required').max(200),
      label: 'Promotion Name',
      control: 'text',
      default: '',
      sample: 'Summer Special',
    },
    description: {
      schema: z.string().max(2000).optional(),
      label: 'Promotion Description',
      control: 'textarea',
      default: '',
      sample: 'Ask at reception to redeem.',
    },
    code: {
      schema: z.string().max(40).optional(),
      label: 'Code (optional)',
      control: 'text',
      default: '',
      // The input upper-cases as you type; a sample that is already upper-case
      // is what the user sees AND what the trimmed body carries.
      sample: 'SUMMER10',
    },
    state: {
      schema: z.enum(['draft', 'active', 'paused']),
      default: 'active',
      exempt:
        'Not answered when writing a promotion — a new one is ALWAYS created ' +
        'active, and editing an existing one carries its saved state through ' +
        'untouched (`offerToForm`). There is no state control on any surface.',
    },
    discountType: {
      schema: z.enum([
        'percentage',
        'fixed_amount',
        'fixed_price',
        'buy_x_get_y',
      ]),
      label: 'Discount',
      control: 'radio',
      default: 'percentage',
      sample: 'percentage',
      sampleLabel: offerDiscountTypeLabels.percentage,
    },

    // percentage — the value that survives when discountType is 'percentage'.
    discountPercent: {
      schema: z.number().int().min(1).max(100).optional().nullable(),
      label: 'Discount Amount',
      control: 'number',
      default: null,
      sample: 20,
    },

    // fixed_amount — entered in euros, sent as cents, and NULLED by the builder
    // whenever the selected discount type is not `fixed_amount`.
    discountAmountEuros: {
      schema: z.number().min(0.01).optional().nullable(),
      label: 'Discount Amount',
      control: 'number',
      default: null,
      sample: 10,
      derived: true,
    },

    // fixed_price (legacy) — euros in, cents out, nulled for other types.
    originalPriceEuros: {
      schema: z.number().min(0).optional().nullable(),
      label: 'Original price',
      control: 'number',
      default: null,
      sample: 100,
      derived: true,
    },
    offerPriceEuros: {
      schema: z.number().min(0).optional().nullable(),
      label: 'Offer price',
      control: 'number',
      default: null,
      sample: 75,
      derived: true,
    },

    // buy_x_get_y (legacy) — driven by the dialog's `buy X get Y` surface, which
    // seeds an offer already using the shape so its radio option renders.
    buyQuantity: {
      schema: z.number().int().min(1).optional().nullable(),
      label: 'Buy',
      control: 'number',
      default: null,
      sample: 2,
    },
    getQuantity: {
      schema: z.number().int().min(1).optional().nullable(),
      label: 'Get',
      control: 'number',
      default: null,
      sample: 1,
    },

    redemptionLimit: {
      schema: z.number().int().min(1).optional().nullable(),
      label: 'Max Redemptions',
      control: 'number',
      default: null,
      sample: 200,
    },

    // Validity window — a popover calendar, so the contract drives it with a
    // `fills` override and the wire value is the picked `Date`'s ISO string.
    validFrom: {
      schema: z.date().optional().nullable(),
      label: 'Start Date',
      control: 'custom',
      default: null,
      sample: null,
      derived: true,
    },
    validUntil: {
      schema: z.date().optional().nullable(),
      label: 'End Date',
      control: 'custom',
      default: null,
      sample: null,
      derived: true,
    },

    // Tag-picker popover / checkbox list — both bespoke, both driven by a
    // `fills` override; the ids reach the wire unchanged.
    serviceIds: {
      schema: z.array(z.string()),
      label: 'Services',
      control: 'custom',
      default: [],
      sample: ['svc-1'],
    },
    locationIds: {
      schema: z.array(z.string()),
      default: [],
      exempt:
        'Derived from the picked services, not answered separately. The ' +
        'services picker groups by branch and writes the branches its ' +
        'selection implies — two independent controls could disagree, and a ' +
        'Cork-only service on a Dublin-only promotion discounts nothing. ' +
        'See offer-services-picker.tsx.',
    },
  },
});

export type OfferFormValues = InferFormValues<typeof offerForm>;

/**
 * The resolver's schema: the declaration plus the cross-field rules a per-field
 * schema cannot express (a required value for the selected discount shape, an
 * offer price below the original, an end date after the start).
 *
 * `defineForm` has no place for a refinement, so it is attached here — the
 * fields are still declared exactly once.
 */
export const offerFormSchema = offerForm.schema.superRefine((data, ctx) => {
  if (data.discountType === 'percentage' && data.discountPercent == null) {
    ctx.addIssue({
      code: 'custom',
      path: ['discountPercent'],
      message: 'Discount percentage is required',
    });
  }
  if (
    data.discountType === 'fixed_amount' &&
    (data.discountAmountEuros == null || data.discountAmountEuros <= 0)
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['discountAmountEuros'],
      message: 'Discount amount is required',
    });
  }
  if (data.discountType === 'fixed_price') {
    if (data.offerPriceEuros == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['offerPriceEuros'],
        message: 'Offer price is required',
      });
    }
    if (
      data.originalPriceEuros != null &&
      data.offerPriceEuros != null &&
      data.offerPriceEuros >= data.originalPriceEuros
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['offerPriceEuros'],
        message: 'Offer price must be lower than original price',
      });
    }
  }
  if (data.discountType === 'buy_x_get_y') {
    if (data.buyQuantity == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['buyQuantity'],
        message: 'Buy quantity is required',
      });
    }
    if (data.getQuantity == null) {
      ctx.addIssue({
        code: 'custom',
        path: ['getQuantity'],
        message: 'Get quantity is required',
      });
    }
  }
  if (data.validFrom && data.validUntil && data.validFrom > data.validUntil) {
    ctx.addIssue({
      code: 'custom',
      path: ['validUntil'],
      message: 'End date must be after start date',
    });
  }
});

export const offerFormDefaultValues = offerForm.defaults;
export const offerFormFields = offerForm.fields;
