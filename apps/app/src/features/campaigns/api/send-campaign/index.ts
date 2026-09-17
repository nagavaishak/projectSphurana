/**
 * The shared core for `POST campaigns` — the composer's one form declaration
 * plus the one send orchestrator both surfaces (desktop + mobile composer) run.
 *
 * The orchestrator itself still lives at `../use-send-campaign` (imported by
 * name across the feature); this barrel is where the form declaration joins it,
 * so the registry's `sharedCore` points at one place.
 */
export {
  type SendCampaignFormValues,
  sendCampaignFields,
  sendCampaignForm,
  sendCampaignFormDefaults,
  sendCampaignFormSchema,
} from './send-campaign.form';
export {
  type SendCampaignIntent,
  useSendCampaign,
} from '../use-send-campaign';
