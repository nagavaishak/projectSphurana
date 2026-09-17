import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import {
  adPlacementValues,
  metaCallToActionValues,
} from '@borradh-workspace/api-client/types';
import { z } from 'zod';

// Step: Ad Source (new vs existing post)
export const adSourceStepSchema = z.object({
  adSource: z.enum(['new', 'existing_post']),
});

// Step: Ad name (mobile wizard only)
export const adNameStepSchema = z.object({
  adName: z.string().min(1, 'Ad name is required').max(255, 'Name too long'),
});

// Step: Select media — ad name + video (web wizard)
export const selectMediaStepSchema = z.object({
  videoId: z.string().min(1, 'Please select a video'),
  adName: z.string().min(1, 'Ad name is required').max(255, 'Name too long'),
});

/** @deprecated Use selectMediaStepSchema (web) or selectVideoOnlyStepSchema (mobile). */
export const selectVideoStepSchema = selectMediaStepSchema;

// Step: Select video only (mobile wizard, after ad-name step)
export const selectVideoOnlyStepSchema = z.object({
  videoId: z.string().min(1, 'Please select media for your ad'),
});

// Step: Select Post (for "existing_post" ad source)
export const selectPostStepSchema = z.object({
  socialPostId: z.string().min(1, 'Please select a post'),
  adName: z.string().min(1, 'Ad name is required').max(255, 'Name too long'),
});

// Step: Select Services
export const selectServicesStepSchema = z.object({
  serviceIds: z.array(z.string()).min(1, 'Select at least one service'),
});

// Step: Details — ad name + single service + page (web 3-step wizard, step 1)
export const detailsStepSchema = z.object({
  adName: z.string().min(1, 'Ad name is required').max(255, 'Name too long'),
  serviceIds: z.array(z.string()).min(1, 'Select a service'),
  metaAdsPageId: z.string().min(1, 'Please select a Facebook Page'),
});

// Step: Ad Placement
export const adPlacementStepSchema = z.object({
  adPlacement: z.enum(adPlacementValues as unknown as [string, ...string[]], {
    message: 'Please select where to show your ad',
  }),
});

// Step: Select Page
export const selectPageStepSchema = z.object({
  metaAdsPageId: z.string().min(1, 'Please select a Facebook Page'),
});

// Step: Customize Ad
export const customizeAdStepSchema = z.object({
  headline: z
    .string()
    .max(80, 'Headline must be 80 characters or less')
    .optional(),
  primaryText: z
    .string()
    .max(500, 'Primary text must be 500 characters or less')
    .optional(),
  description: z
    .string()
    .max(30, 'Description must be 30 characters or less')
    .optional(),
  callToAction: z.enum(metaCallToActionValues).default('LEARN_MORE'),
  destinationUrl: z
    .string()
    .url('Please enter a valid URL')
    .optional()
    .or(z.literal('')),
});

// Step: Lead Form (required when campaign type is lead_form)
export const leadFormStepSchema = z.object({
  leadFormId: z.string().min(1, 'Please select or create a lead form'),
});

// Step: Campaign Selection (required — no inline creation)
export const campaignStepSchema = z.object({
  campaignId: z.string().min(1, 'Please select a campaign'),
});

/**
 * THE ad wizard form, declared ONCE.
 *
 * Both surfaces — the desktop `AdWizardForm` and the mobile `AdMobileWizard` —
 * render these labels, validate against this schema, and hand the values to the
 * one `buildCreateAdPayload` (save as draft) / `buildLaunchAdPayload` (publish).
 *
 * The wizard is a four-step walk (campaign → details → media → customize), so a
 * field's control lives in its step; the contract specs fill each field at the
 * step where it becomes reachable. See `@/lib/form-contract/define-form`.
 */
export const adWizardForm = defineForm({
  fields: {
    campaignId: {
      // A Select on desktop, a card list on mobile. Sent as `metaCampaignId`.
      schema: z.string().min(1, 'Please select a campaign'),
      label: 'Campaign',
      control: 'custom',
      default: '',
      sample: 'camp_1',
      derived: true,
    },
    adName: {
      schema: z
        .string()
        .min(1, 'Ad name is required')
        .max(255, 'Name too long'),
      label: 'Ad name',
      control: 'text',
      default: '',
      sample: 'My Test Ad',
      derived: true, // sent as `name`
    },
    serviceIds: {
      // Searchable single-select combobox (shared DetailsStep).
      schema: z.array(z.string()).min(1, 'Select at least one service'),
      label: 'Service',
      control: 'custom',
      default: [],
      sample: ['svc_1'],
    },
    metaAdsPageId: {
      // A list of Page cards (shared DetailsStep); auto-selects a lone Page.
      schema: z.string().optional(),
      label: 'Facebook Page',
      control: 'custom',
      default: '',
      sample: 'page_1',
    },
    videoId: {
      // The media grid (desktop tabs / mobile thumbnails) — video, uploaded
      // asset or graphic, all stored in this one id.
      schema: z.string().optional(),
      label: 'Ad media',
      control: 'custom',
      default: '',
      sample: 'vid_1',
    },
    headline: {
      schema: z.string().max(80).optional(),
      label: 'Headline',
      control: 'text',
      default: '',
      sample: 'Balayage, done right',
    },
    primaryText: {
      schema: z.string().max(500).optional(),
      label: 'Primary Text',
      control: 'textarea',
      default: '',
      sample: 'Book your balayage with our senior stylists this month.',
    },
    description: {
      schema: z.string().max(30).optional(),
      label: 'Description',
      control: 'text',
      default: '',
      sample: 'Limited slots',
    },
    callToAction: {
      schema: z.enum(metaCallToActionValues),
      label: 'Call to Action',
      control: 'select',
      default: 'LEARN_MORE',
      sample: 'SIGN_UP',
      sampleLabel: 'Sign Up',
    },
    destinationUrl: {
      schema: z.string().url().optional().or(z.literal('')),
      label: 'Destination URL',
      control: 'text',
      default: '',
      sample: 'https://example.com',
    },
    adPlacement: {
      schema: z.enum(adPlacementValues as unknown as [string, ...string[]]),
      default: 'facebook',
      exempt:
        'placement is not a wizard step — every ad ships Facebook placement (see config/-steps.ts). AdPlacementStep is built but unrouted.',
    },
    leadFormId: {
      schema: z.string().optional(),
      default: '',
      exempt:
        'inherited from the campaign, not chosen per ad — there is no lead-form step in either wizard (see config/-steps.ts)',
    },
    adSource: {
      schema: z.enum(['new', 'existing_post']),
      default: 'new',
      exempt:
        '"use existing post" is disabled — AdSourceStep/SelectPostStep are commented out of both wizards, so every ad is the "new" flow',
    },
    socialPostId: {
      schema: z.string().optional(),
      default: '',
      exempt:
        'only set by the disabled "use existing post" flow — see adSource',
    },
  },
});

export const adWizardSchema = adWizardForm.schema;
export const defaultAdWizardValues = adWizardForm.defaults;
export const adWizardFields = adWizardForm.fields;
export const adWizardLabels = adWizardForm.labels;

export type AdWizardFormData = InferFormValues<typeof adWizardForm>;
