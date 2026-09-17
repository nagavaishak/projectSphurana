import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The create-campaign form, declared ONCE.
 *
 * BOTH surfaces — the desktop `CreateCampaignDialog` and the mobile
 * `CampaignMobileCreate` funnel — render these labels, validate against this
 * schema and build their Meta payload with `buildCreateCampaignPayload`, so the
 * two can never drift again.
 *
 * See `@/lib/form-contract/define-form` for why the shape is this way.
 */
export const createCampaignForm = defineForm({
  fields: {
    name: {
      schema: z
        .string()
        .min(1, 'Name is required')
        .max(255, 'Name is too long'),
      label: 'Name',
      control: 'text',
      default: '',
      sample: 'Lipo Campaign',
    },
    dailyBudget: {
      // Typed in major units ('25.50'); the builder sends minor units (2550).
      schema: z.string().min(1, 'Daily budget is required'),
      label: 'Daily budget',
      control: 'number',
      default: '15',
      sample: '25.50',
      derived: true,
    },
    targetingLocation: {
      // A geocoding search (desktop inline, mobile in a sheet), not a plain
      // input — and it lands nested under `targeting` on the wire.
      schema: z.string().min(1, 'Please select a location'),
      label: 'Location',
      control: 'custom',
      default: '',
      sample: 'Dublin',
      derived: true,
    },
    targetingLatitude: {
      schema: z.number(),
      default: 0,
      exempt:
        'geocoded by the Location search — set together with targetingLocation, never on its own',
    },
    targetingLongitude: {
      schema: z.number(),
      default: 0,
      exempt:
        'geocoded by the Location search — set together with targetingLocation, never on its own',
    },
    targetingDistanceKm: {
      schema: z.number().min(1).max(500),
      label: 'Radius',
      control: 'custom',
      default: 25,
      sample: 40,
      derived: true,
    },
    followUpType: {
      // Radio cards on desktop, a button pair on mobile.
      schema: z.enum(['lead_form', 'chatbot']),
      label: 'How should leads reach you?',
      control: 'custom',
      default: 'lead_form',
      sample: 'chatbot',
      sampleLabel: 'Leads should message us',
    },
    /**
     * Chatbot campaigns can optimize for lead generation (form submissions) or
     * engagement (conversations). Lead-form campaigns are always OUTCOME_LEADS.
     * Never sent as-is: it resolves into the Meta `objective`.
     */
    optimizationMode: {
      schema: z.enum(['lead_generation', 'engagement']),
      label: 'Optimization',
      control: 'custom',
      default: 'lead_generation',
      sample: 'engagement',
      sampleLabel: 'Engagement',
      derived: true,
    },
    leadFormId: {
      // Only rendered — and only sent — by lead-form campaigns; the builder
      // drops it for chatbot ones.
      schema: z.string(),
      label: 'Lead form',
      control: 'custom',
      default: '',
      sample: 'lf_1',
    },
    destinations: {
      // Checkbox cards on desktop, segmented tabs on mobile — chatbot only.
      schema: z.array(z.string()),
      label: 'Where can leads message you?',
      control: 'custom',
      default: [],
      sample: ['messenger', 'instagram_dm'],
    },
  },
});

export const createCampaignFormSchema = createCampaignForm.schema;
export const createCampaignFormDefaultValues = createCampaignForm.defaults;
export const createCampaignFormFields = createCampaignForm.fields;
export const createCampaignFormLabels = createCampaignForm.labels;

export type CreateCampaignFormData = InferFormValues<typeof createCampaignForm>;

/** Meta rejects Lead Generation optimization for WhatsApp destinations. */
export function forcesEngagement(destinations: string[]): boolean {
  return destinations.includes('whatsapp');
}

/**
 * The optimization picker only applies to chatbot campaigns, and is hidden when
 * WhatsApp is one of the destinations (Meta forces Engagement there).
 */
export function showsOptimizationMode(data: {
  followUpType: string;
  destinations: string[];
}): boolean {
  return (
    data.followUpType === 'chatbot' && !forcesEngagement(data.destinations)
  );
}
