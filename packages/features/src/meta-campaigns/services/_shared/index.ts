export {
  getMetaCredentials,
  type GetCredentialsOptions,
  type CredentialsResult,
} from '../../../meta-ads/services/_shared/index.js';

// Campaign landing destination + UTM tagging (plan §9.5). The host is ALWAYS
// resolved through `resolveMicrositeLinkTarget`; never composed by hand.
export {
  buildCampaignDestinationUrl,
  campaignHasSiteDestination,
  resolveCampaignDestinationUrl,
} from './campaign-destination.js';

// A campaign's geo comes from a BRANCH, never a typed address or a
// model-supplied coordinate. See the file header for the two live bugs that
// made this the only accepted input.
export {
  resolveCampaignLocation,
  buildTargetingForLocation,
  type CampaignLocation,
} from './resolve-campaign-location.js';
