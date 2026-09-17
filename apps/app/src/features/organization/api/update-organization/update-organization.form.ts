import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import {
  stylePreferenceLabels,
  stylePreferenceValues,
} from '@borradh-workspace/api-client/types';
import { depositBasisLabels } from '@borradh-workspace/api-client/types';
import { z } from 'zod';

/**
 * The organization-settings form, declared ONCE — every field any surface can
 * patch, with its schema, its label, its control and its default on one line.
 *
 * `PATCH organization/active` is unusual: SIX forms share it, and they own
 * DISJOINT slices of the entity. The details page owns the name and the public
 * URLs; the style page owns the logo, the brand colours and the generated-content
 * defaults; the bookings tab owns the calendar mode, the deposit and the
 * rescheduling policy; the privacy tab owns one switch. That is deliberate —
 * `buildUpdateOrganizationPayload` emits only the keys present on the intent,
 * precisely so each surface patches what it owns and nothing else.
 *
 * Ownership therefore lives on the CONTRACT's surfaces (`Surface.owns`), not
 * here. This file stays the single source of the 17 fields: each surface builds
 * its local zod object from these specs and renders these labels, so a field
 * cannot be spelled one way on the settings route and another in the dialog —
 * which is exactly how `name` came to be "Organisation name" in one place and
 * "Organization Name" in the other.
 */

const hexColor = /^#[0-9A-Fa-f]{6}$/;

export const updateOrganizationForm = defineForm({
  fields: {
    // ---- settings/details route
    name: {
      schema: z.string().min(2, 'Name must be at least 2 characters'),
      label: 'Organisation name',
      control: 'text',
      default: '',
      sample: 'Acme Clinic',
    },
    websiteUrl: {
      schema: z.string().url('Enter a valid URL').or(z.literal('')),
      label: 'Website',
      control: 'text',
      default: '',
      sample: 'https://acme.example.com',
    },
    privacyPolicyUrl: {
      schema: z.string().url('Enter a valid URL').or(z.literal('')),
      label: 'Privacy policy URL',
      control: 'text',
      default: '',
      sample: 'https://acme.example.com/privacy',
    },

    // ---- settings/style route + org-settings dialog, branding tab
    logo: {
      // An avatar + hidden file input, and the URL that reaches the wire is the
      // one the UPLOAD returns — not anything the user typed. Custom control,
      // derived value; the contract drives the picker and names the wire URL.
      schema: z.string().optional(),
      label: 'Business logo',
      control: 'custom',
      default: '',
      sample: '',
      derived: true,
    },
    primaryColor: {
      schema: z.string().regex(hexColor, 'Invalid hex color').optional(),
      label: 'Primary colour',
      control: 'text',
      default: '#000000',
      sample: '#112233',
    },
    secondaryColor: {
      schema: z.string().regex(hexColor, 'Invalid hex color').optional(),
      label: 'Secondary colour',
      control: 'text',
      default: '#FFCC00',
      sample: '#AABBCC',
    },
    videoMusicVolume: {
      // A 0-100 slider over a 0-1 value. No generic driver for a slider, so the
      // contract drives it by keyboard.
      schema: z.number().min(0).max(1),
      label: 'Music volume',
      control: 'custom',
      default: 0.05,
      sample: 0.06,
    },
    stylePreference: {
      schema: z.enum(stylePreferenceValues),
      label: 'Graphic style',
      control: 'select',
      default: 'clean',
      sample: 'basic',
      sampleLabel: stylePreferenceLabels.basic,
    },
    brandStyleGuide: {
      schema: z.string().max(8000, 'Too long').optional(),
      label: 'Brand style guide',
      control: 'textarea',
      default: '',
      sample: 'Navy and gold. Geometric sans headings.',
    },

    // ---- org-settings dialog, bookings tab
    bookingDestination: {
      // The user picks a BOOKING METHOD; `bookingDestination` is what that
      // choice means on the wire (ENG-500). The legacy `primaryCalendarType`
      // is derived from it server-side until PR 2 drops that column, so it is
      // no longer settable here.
      schema: z.enum(['borradh', 'external_link']),
      label: 'Booking Method',
      control: 'radio',
      default: 'borradh',
      sample: 'borradh',
      sampleLabel: 'Borradh Calendar',
      derived: true,
    },
    defaultBookingLink: {
      schema: z
        .string()
        .url('Please enter a valid URL')
        .optional()
        .or(z.literal('')),
      label: 'Booking URL',
      control: 'text',
      default: '',
      sample: 'https://book.example.com/acme',
    },
    depositEnabled: {
      schema: z.boolean(),
      label: 'Require a booking deposit',
      control: 'switch',
      default: false,
      sample: true,
    },
    defaultDepositBasis: {
      schema: z.enum(['fixed', 'percent']),
      label: 'Deposit type',
      control: 'select',
      default: 'fixed' as const,
      sample: 'percent' as const,
      sampleLabel: depositBasisLabels.percent,
    },
    defaultDepositPercent: {
      schema: z
        .number()
        .int()
        .min(1, 'Must be at least 1%')
        .max(100, 'Cannot exceed 100%')
        .optional(),
      label: 'Deposit percentage',
      control: 'number',
      default: 20,
      sample: 30,
    },
    depositAmount: {
      // Entered in major units, stored in cents — the classic derived field.
      schema: z
        .number()
        .min(0, 'Amount cannot be negative')
        .max(10000, 'Amount too large')
        .optional(),
      label: 'Deposit amount',
      control: 'number',
      default: 0,
      sample: 25,
      derived: true,
    },
    reschedulingNoticeRequiredHours: {
      // A 0-48h slider (step 1), only rendered while the rescheduling toggle
      // above is ON. No generic driver for a slider, so the contract drives it
      // by keyboard — sample = the hydrated fixture value (12) + one ArrowRight.
      schema: z.number().int().min(0, 'Must be 0 or more').optional(),
      label: 'Notice Required (hours)',
      control: 'custom',
      default: 24,
      sample: 13,
    },
    noShowOrLateCancelFeeCents: {
      // Shown in major units (£15), stored in cents (1500).
      //
      // A STATED fee, not a charged one. Nothing in the product collects it:
      // it is surfaced on the booking page and quoted by Claire when she
      // evaluates a reschedule, and the clinic collects it themselves. The
      // implemented money path is deposits (create-deposit-request et al),
      // which is a separate mechanism and can only work where a payment
      // method was captured.
      //
      // The label says so, because a setting that LOOKS enforced and isn't is
      // worse than no setting: the clinic sets £25, changes nothing about how
      // they run their diary, and finds out months later that nothing was
      // ever charged.
      schema: z
        .number()
        .int()
        .min(0, 'Must be 0 or more')
        .optional()
        .nullable(),
      label: 'Late Cancel / No-Show Fee (you collect this)',
      control: 'number',
      default: null,
      sample: 15,
      derived: true,
    },
    customerReschedulingEnabled: {
      schema: z.boolean(),
      label: 'Allow rescheduling online',
      control: 'switch',
      // DB default: NOT NULL DEFAULT true.
      default: true,
      sample: true,
    },
    customerCancellationsEnabled: {
      schema: z.boolean(),
      label: 'Allow customers to cancel online',
      control: 'switch',
      // DB default: NOT NULL DEFAULT true.
      default: true,
      sample: true,
    },
    cancellationNoticeRequiredHours: {
      // A 0-48h slider (step 1), only rendered while the toggle above is ON.
      // No generic driver for a slider, so the contract drives it by keyboard —
      // sample = the hydrated fixture value (12) + one ArrowRight step.
      schema: z.number().int().min(0).max(48),
      label: 'Notice required',
      control: 'custom',
      default: 0,
      sample: 13,
    },

    // ---- org-settings dialog, privacy tab
    contributeToAggregateInsights: {
      schema: z.boolean(),
      label: 'Contribute to aggregate insights',
      control: 'switch',
      default: true,
      sample: false,
    },
  },
});

/** The per-field specs — each surface builds its own slice's schema from these. */
export const updateOrganizationFields = updateOrganizationForm.specs;

export type UpdateOrganizationFormValues = InferFormValues<
  typeof updateOrganizationForm
>;
