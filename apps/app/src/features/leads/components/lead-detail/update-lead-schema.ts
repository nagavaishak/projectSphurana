import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import {
  leadSourceLabels,
  leadSourceValues,
  leadStatusLabels,
  leadStatusValues,
} from '@borradh-workspace/api-client/types';
import { z } from 'zod';

/**
 * The update-lead form, declared ONCE.
 *
 * Both edit surfaces — the docked {@link LeadDetailPanel} and the client
 * profile's {@link ClientDetailsTab} — render the same {@link LeadEditFields}
 * from this declaration and pass the resulting intent to the one
 * `buildUpdateLeadPayload`. The zod schema, the `defaultValues` and the labels
 * the JSX renders all come from here, so a field cannot exist in two of them and
 * be missing from the third.
 *
 * See `@/lib/form-contract/define-form` for why the shape is this way.
 *
 * `portalNote` is NOT a field here, deliberately (ENG-791). It is the note
 * PUBLISHED to the customer's portal, and it is edited on exactly one surface —
 * the profile's Notes tab — where it saves on its own button and touches only
 * its own key. Declaring it here would put it back on every surface that
 * renders this form, and those forms submit the whole record from their own
 * last-fetched snapshot: that is how saving a phone number came to revert (or
 * clear) an aftercare note. The form contract drives every field declared here
 * through every surface, so its absence is enforced rather than merely
 * intended.
 */
export const updateLeadForm = defineForm({
  fields: {
    firstName: {
      schema: z.string().min(1, 'First name is required'),
      label: 'First Name *',
      control: 'text',
      default: '',
      sample: 'Bobby',
    },
    lastName: {
      schema: z.string().optional(),
      label: 'Last Name',
      control: 'text',
      default: '',
      sample: 'Tables',
    },
    email: {
      schema: z.string().email('Invalid email').optional().or(z.literal('')),
      label: 'Email',
      control: 'email',
      default: '',
      sample: 'bobby@example.com',
    },
    phone: {
      schema: z.string().optional(),
      label: 'Phone',
      control: 'tel',
      default: '',
      sample: '+353015550100',
    },
    whatsapp: {
      schema: z.string().optional(),
      label: 'WhatsApp',
      control: 'tel',
      default: '',
      sample: '+353015550101',
    },
    source: {
      schema: z.enum(leadSourceValues),
      label: 'Source',
      control: 'select',
      default: 'manual',
      sample: 'referral',
      sampleLabel: leadSourceLabels.referral,
    },
    status: {
      schema: z.enum(leadStatusValues),
      label: 'Status',
      control: 'select',
      default: 'new',
      sample: 'contacted',
      sampleLabel: leadStatusLabels.contacted,
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
      label: 'Internal notes',
      control: 'textarea',
      default: '',
      sample: 'Reschedules often.',
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

export const updateLeadFormSchema = updateLeadForm.schema;
export const updateLeadDefaultValues = updateLeadForm.defaults;
export const updateLeadFields = updateLeadForm.fields;

export type UpdateLeadFormValues = InferFormValues<typeof updateLeadForm>;
