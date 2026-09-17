import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import {
  leadSourceLabels,
  leadSourceValues,
} from '@borradh-workspace/api-client/types';
import { z } from 'zod';

/**
 * The create-lead form, declared ONCE.
 *
 * Every key appears on exactly one line, carrying its schema, its label, its
 * control and its default together. The zod schema, the `defaultValues` and the
 * field registry the JSX renders are all derived from it — so adding `phone` is
 * one line, and deleting it takes the field out of all three at once, instead of
 * leaving two of them pointing at a field the user can no longer reach.
 *
 * See `@/lib/form-contract/define-form` for why the shape is this way.
 */
export const createLeadForm = defineForm({
  fields: {
    firstName: {
      schema: z.string().min(1, 'First name is required'),
      label: 'First Name *',
      control: 'text',
      default: '',
      sample: 'Ada',
    },
    lastName: {
      schema: z.string().optional(),
      label: 'Last Name',
      control: 'text',
      default: '',
      sample: 'Lovelace',
    },
    email: {
      schema: z.string().email('Invalid email').optional().or(z.literal('')),
      label: 'Email',
      control: 'email',
      default: '',
      sample: 'ada@example.com',
    },
    phone: {
      schema: z.string().optional(),
      label: 'Phone',
      control: 'tel',
      default: '',
      sample: '+353015550000',
    },
    whatsapp: {
      schema: z.string().optional(),
      label: 'WhatsApp',
      control: 'tel',
      default: '',
      sample: '+353015550001',
    },
    source: {
      schema: z.enum(leadSourceValues),
      label: 'Source *',
      control: 'select',
      default: 'manual',
      sample: 'referral',
      sampleLabel: leadSourceLabels.referral,
    },
    tags: {
      // A bespoke type-and-Enter chip input rather than a labelled control, so
      // the contract drives it with a `fills.tags` override.
      schema: z.array(z.string()).optional(),
      label: 'Tags',
      control: 'custom',
      default: [],
      sample: ['vip'],
    },
    notes: {
      schema: z.string().optional(),
      label: 'Notes',
      control: 'textarea',
      default: '',
      sample: 'Prefers morning appointments.',
    },
    consentEmail: {
      schema: z.boolean().optional(),
      label: 'Email',
      control: 'checkbox',
      default: false,
      sample: true,
    },
    consentSms: {
      schema: z.boolean().optional(),
      label: 'SMS',
      control: 'checkbox',
      default: false,
      sample: true,
    },
    consentVoice: {
      schema: z.boolean().optional(),
      label: 'Voice Calls',
      control: 'checkbox',
      default: false,
      sample: true,
    },
  },
});

export const createLeadSchema = createLeadForm.schema;
export const createLeadDefaultValues = createLeadForm.defaults;
export const createLeadFields = createLeadForm.fields;

export type CreateLeadFormValues = InferFormValues<typeof createLeadForm>;
