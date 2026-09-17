import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

import {
  type LeadFormFieldType,
  defaultLeadFormQuestions,
  leadFormFieldTypeValues,
  leadFormFollowUpChannelValues,
} from '../api/types';
import type { LeadFormBuilderValue } from './lead-form-builder';

/**
 * The lead-form builder, declared as a form.
 *
 * The builder predates `defineForm` and owns its own state shape and validator
 * (`validateLeadFormBuilder`), which are NOT rewritten here — a migration that
 * quietly changes what a form validates is a bug, not a refactor. What this adds
 * is the declaration the form contract needs: one line per key carrying its
 * label, its control and the sample the harness fills in.
 *
 * The two shapes are bound at COMPILE TIME by `toBuilderValue` /
 * `fromBuilderValue` below, so a key added to either side and not the other
 * fails to build rather than silently escaping the contract.
 */
const questionSchema = z.object({
  id: z.string(),
  type: z.enum(
    leadFormFieldTypeValues as [LeadFormFieldType, ...LeadFormFieldType[]]
  ),
  label: z.string().optional(),
  key: z.string().optional(),
  options: z
    .array(z.object({ value: z.string(), key: z.string().optional() }))
    .optional(),
});

/** The seeded question rows. Ids are client-side only and never reach the wire. */
const DEFAULT_QUESTIONS = defaultLeadFormQuestions.map((question, index) => ({
  ...question,
  id: `seed-${index}`,
}));

export const leadFormForm = defineForm({
  fields: {
    name: {
      schema: z.string().min(1, 'Form name is required'),
      label: 'Form name',
      control: 'text',
      default: '',
      sample: 'Spring Offer Enquiries',
    },
    questions: {
      // A reorderable row builder with an inline per-row editor — driven by a
      // contract fill. `derived` because the wire drops the client-side row ids
      // and normalises option keys.
      schema: z.array(questionSchema),
      label: 'Fields',
      control: 'custom',
      default: DEFAULT_QUESTIONS,
      sample: DEFAULT_QUESTIONS,
      derived: true,
    },
    followUpChannel: {
      // A stack of aria-pressed channel cards, not a select.
      schema: z.enum(leadFormFollowUpChannelValues),
      label: 'Instant form lead nurturing',
      control: 'custom',
      default: 'none',
      sample: 'whatsapp',
    },
    whatsappNumber: {
      // Revealed only once the WhatsApp channel is picked, so the contract must
      // fill `followUpChannel` first.
      schema: z.string(),
      label: 'WhatsApp business number',
      control: 'text',
      default: '',
      sample: '+353851234567',
    },
    privacyPolicyUrl: {
      schema: z.string(),
      // The rendered label carries the "(optional)" hint; the harness locates
      // the control by exactly what a user reads.
      label: 'Privacy policy URL (optional)',
      control: 'text',
      default: '',
      sample: 'https://example.com/privacy-policy',
    },
    thankYouTitle: {
      schema: z.string(),
      label: 'Title',
      control: 'text',
      default: '',
      sample: 'Thank you!',
    },
    thankYouBody: {
      schema: z.string(),
      label: 'Message',
      control: 'textarea',
      default: '',
      sample: "We'll be in touch soon.",
    },
  },
});

export type LeadFormDeclaredValues = InferFormValues<typeof leadFormForm>;

/**
 * The compile-time binding between this declaration and the builder's own value
 * type. Either direction failing to typecheck means the two have drifted.
 */
export const toBuilderValue = (
  values: LeadFormDeclaredValues
): LeadFormBuilderValue => values;

export const fromBuilderValue = (
  values: LeadFormBuilderValue
): LeadFormDeclaredValues => values;
