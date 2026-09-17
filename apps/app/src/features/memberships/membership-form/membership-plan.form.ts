import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { parseMajorToCents } from '@/lib/org-currency';
import {
  membershipPricingTypeValues,
  membershipValidForLabels,
  membershipValidForValues,
} from '@borradh-workspace/api-client/types';
import { z } from 'zod';

/**
 * The membership plan form, declared ONCE.
 *
 * Every key carries its schema, its label, its control and its default on one
 * line; the defaults the editor starts from, the labels it renders and the
 * samples the form contract types in are all derived from it. What the user
 * enters is not what reaches the wire — a price is typed in major units and
 * sent as cents, and "unlimited" is a radio here but a `null` sessionCount
 * there — so those keys are `derived` and `buildMembershipPlanPayload` owns the
 * mapping.
 *
 * See `@/lib/form-contract/define-form` for why the shape is this way.
 */
export const membershipPlanForm = defineForm({
  fields: {
    name: {
      schema: z.string().min(1, 'Name is required'),
      label: 'Name',
      control: 'text',
      default: '',
      sample: 'Gold membership',
    },
    description: {
      schema: z.string(),
      label: 'Description',
      control: 'textarea',
      default: '',
      sample: '10 sessions redeemable against services',
    },
    // Searchable popover + removable chips — bespoke, driven by a `fills`
    // override; the ids reach the wire unchanged.
    serviceIds: {
      schema: z.array(z.string()),
      label: 'Included services',
      control: 'custom',
      default: [],
      sample: ['svc-1'],
    },
    /**
     * Limited / unlimited. `custom` rather than `radio` because "Limited" is a
     * substring of "Unlimited", so a generic name match cannot tell the two
     * apart — and picking the wrong one silently hides the session count.
     */
    sessionsMode: {
      schema: z.enum(['limited', 'unlimited']),
      label: 'Sessions',
      control: 'custom',
      default: 'limited',
      sample: 'limited',
      derived: true,
    },
    sessionCount: {
      schema: z.string(),
      label: 'Number of sessions',
      control: 'number',
      default: '10',
      sample: '8',
      derived: true,
    },
    pricingType: {
      schema: z.enum(membershipPricingTypeValues),
      label: 'Pricing',
      control: 'radio',
      default: 'one_time',
      sample: 'one_time',
      sampleLabel: 'One-time',
    },
    validFor: {
      schema: z.enum(membershipValidForValues),
      label: 'Valid for',
      control: 'select',
      default: '1m',
      sample: '3m',
      sampleLabel: membershipValidForLabels['3m'],
    },
    // Typed in major units, sent as cents.
    priceRaw: {
      schema: z.string().min(1, 'Price is required'),
      label: 'Price',
      control: 'text',
      default: '',
      sample: '120.00',
      derived: true,
    },
  },
});

export type MembershipPlanFormValues = InferFormValues<
  typeof membershipPlanForm
>;

export const membershipPlanFormDefaults = membershipPlanForm.defaults;
export const membershipPlanLabels = membershipPlanForm.labels;

/**
 * The ONE membership-plan wire body. Both create and update send it; the only
 * difference is the endpoint.
 *
 * Blank description reaches the wire as ABSENCE, not `''` — a persisted empty
 * string says "this plan's description is the empty string" rather than "this
 * plan has no description", and is the shape that 400'd `POST /leads`.
 */
export function buildMembershipPlanPayload(
  values: MembershipPlanFormValues,
  options: { isActive?: boolean } = {}
) {
  const name = values.name.trim();
  if (!name) throw new Error('Name is required');

  const priceCents = parseMajorToCents(values.priceRaw);
  if (priceCents == null || priceCents <= 0) {
    throw new Error('Enter a valid price');
  }

  const sessionCount =
    values.sessionsMode === 'unlimited'
      ? null
      : Number.parseInt(values.sessionCount, 10);
  if (
    values.sessionsMode === 'limited' &&
    (!Number.isInteger(sessionCount) || (sessionCount ?? 0) <= 0)
  ) {
    throw new Error('Enter a valid number of sessions');
  }

  return {
    name,
    description: values.description.trim() || undefined,
    sessionCount,
    pricingType: values.pricingType,
    validFor: values.validFor,
    priceCents,
    currency: 'eur',
    isActive: options.isActive ?? true,
    serviceIds: values.serviceIds,
  };
}
