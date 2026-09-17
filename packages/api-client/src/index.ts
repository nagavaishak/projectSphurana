// @borradh-workspace/api-client
// Shared HTTP client for Next.js and Expo applications

// Core client
export {
  apiClient,
  configureApiClient,
  getApiClientConfig,
  setAdminOrgOverride,
  setActiveLocationId,
  getActiveLocationId,
} from './client.js';

// Types
export type {
  ApiClientConfig,
  ApiError,
  AuthProvider,
  RequestOptions,
} from './types.js';

// Schema-aware response parsing (report/strict, gated by the app flag system)
export {
  parseResponse,
  ResponseParseError,
  setResponseParseConfig,
} from './parse.js';
export type {
  ResponseParseConfig,
  ResponseParseErrorInfo,
  ResponseSchema,
} from './parse.js';

// Error utilities
export {
  ApiClientError,
  getMetaErrorDetail,
  getMetaErrorDetailAsync,
  isApiClientError,
  isNetworkError,
  isTimeoutError,
  type MetaErrorDetail,
} from './errors.js';

// Campaign content kit — pure, browser-safe "what actually sends" helpers.
export {
  CANONICAL_WHATSAPP_TEMPLATE,
  WHATSAPP_STOP_LINE,
  type CampaignWhatsappTemplateAtom,
  type RenderCampaignEmailHtmlOptions,
  type ResolvedCampaignWhatsappTemplate,
  fillWhatsappTemplate,
  renderCampaignEmailHtml,
  resolveCampaignWhatsappTemplate,
} from './campaigns.js';
