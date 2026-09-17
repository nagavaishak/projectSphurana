/**
 * THE registry of Graph API endpoints this codebase calls.
 *
 * One entry per endpoint shape. Each carries the HTTP method, a path matcher,
 * and (once schemas land) the request/response schemas.
 *
 * WHAT THIS IS FOR
 * ----------------
 * Three consumers share this one registry, which is the point — they cannot
 * drift from each other:
 *   1. The E2E contract fake (`META_E2E_STUB`) resolves a request to an entry,
 *      validates it, and answers from the response schema.
 *   2. The request-contract unit tests assert that the payload our product code
 *      builds parses against the SAME request schema the fake enforces.
 *   3. The nightly real-Meta run validates actual Graph responses against the
 *      SAME response schemas, which is how drift surfaces.
 *
 * SCOPE
 * -----
 * Derived by static enumeration of our own call sites — `apiRequest(...)` in
 * `meta-ads` / `meta-messaging`, the URL builders in `whatsapp-cloud`, and the
 * features-level Graph calls in `social-posts` / `conversations` /
 * `integrations`. It describes the subset of Graph WE use, not all of Graph.
 *
 * OAuth endpoints are deliberately absent: the connected E2E specs don't drive
 * them. An unmatched request HARD FAILS in the fake rather than passing
 * through, so if that assumption is wrong we find out immediately and loudly
 * instead of silently hitting real Meta.
 *
 * ADDING AN ENDPOINT
 * ------------------
 * Add the entry here, then its request/response schemas. The fake's
 * "unknown Graph endpoint" error names the method and path to add.
 */

/** Which Graph host family an endpoint belongs to. */
export type GraphHost = 'facebook' | 'instagram';

export type GraphMethod = 'GET' | 'POST' | 'DELETE';

export interface GraphEndpoint {
  /** Stable id, `{group}.{operation}`. Used in recordings and error messages. */
  id: string;
  method: GraphMethod;
  host: GraphHost;
  /**
   * Matches the path AFTER the version prefix, with the leading slash.
   * e.g. `/act_123/ads`, `/me/messages`, `/1234567890`.
   */
  match: RegExp;
  /** Human note — what our code uses this for. */
  note: string;
}

/**
 * Path fragments used across several matchers.
 *
 * A Graph node id is digits in production, but our E2E fake mints ids like
 * `stub-ad-1` and the magic-id directives use `E2E…` prefixes, so node matching
 * must accept word characters and dashes — not `\d+`.
 */
const NODE = '[\\w-]+';
const ACT = 'act_[\\w-]+';

export const GRAPH_ENDPOINTS: GraphEndpoint[] = [
  // ── Marketing API: campaigns ────────────────────────────────────────────
  {
    id: 'ads.createCampaign',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${ACT}/campaigns$`),
    note: 'MetaAdsService.createCampaign',
  },
  {
    id: 'ads.listCampaigns',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${ACT}/campaigns$`),
    note: 'MetaAdsService.listCampaigns — THE SPINE of list-campaigns.service',
  },
  {
    id: 'ads.duplicateCampaign',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/copies$`),
    note: 'MetaAdsService.copyCampaign (deep copy)',
  },
  {
    id: 'ads.listCampaignInsights',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${ACT}/insights$`),
    note: 'MetaAdsService.getCampaignInsights (account level)',
  },
  {
    id: 'ads.getFundingSource',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${ACT}$`),
    note: 'getFundingSource + getAdAccountHealth — same node, different fields; the pre-publish gate reads this',
  },

  // ── Marketing API: ad sets, creatives, ads ──────────────────────────────
  {
    id: 'ads.createAdSet',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${ACT}/adsets$`),
    note: 'MetaAdsService.createAdSet',
  },
  {
    id: 'ads.createAdCreative',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${ACT}/adcreatives$`),
    note: 'createAdCreative / createAdCreativeFromImage / …FromPost',
  },
  {
    id: 'ads.createAd',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${ACT}/ads$`),
    note: 'MetaAdsService.createAd',
  },
  {
    id: 'ads.listAds',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${ACT}/ads$`),
    note: 'listActiveAds / listAllAds / listAllAdsWithCreative',
  },
  // Node-scoped edges. These MUST stay below their `act_`-scoped twins above:
  // `NODE` matches `act_123` too, and first match wins.
  {
    id: 'ads.listCampaignAds',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/ads$`),
    note: 'MetaAdsService.listCampaignAdsWithCreative — spine of list-ads.service',
  },
  {
    id: 'ads.listCampaignAdSets',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/adsets$`),
    note: 'MetaAdsService — ad sets of a campaign',
  },

  // ── Marketing API: media upload ─────────────────────────────────────────
  {
    id: 'ads.uploadVideo',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${ACT}/advideos$`),
    note: 'uploadVideoSingle + chunked start/transfer/finish',
  },
  {
    id: 'ads.uploadImage',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${ACT}/adimages$`),
    note: 'MetaAdsService.uploadImage',
  },

  // ── Marketing API: lead-gen forms ───────────────────────────────────────
  {
    id: 'ads.createLeadGenForm',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/leadgen_forms$`),
    note: 'MetaAdsService.createLeadGenForm (page-scoped)',
  },
  {
    id: 'ads.listLeadGenForms',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/leadgen_forms$`),
    note: 'MetaAdsService — existing forms on a page',
  },
  {
    id: 'ads.listFormLeads',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/leads$`),
    note: 'MetaAdsService — leads submitted against a form',
  },

  // ── Page webhook subscription ───────────────────────────────────────────
  {
    id: 'pages.subscribeApp',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/subscribed_apps$`),
    note: 'MetaAdsService + MetaMessagingService.subscribeToMessaging',
  },

  // ── Node-level insights (campaign / ad) ─────────────────────────────────
  {
    id: 'ads.nodeInsights',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/insights$`),
    note: 'getCampaignInsights / getAdInsights / getAdInsightsDaily; also page insights',
  },

  // ── Messenger send + read ───────────────────────────────────────────────
  {
    id: 'messaging.send',
    method: 'POST',
    host: 'facebook',
    match: /^\/me\/messages$/,
    note: 'sendTextMessage / sendQuickReply / sendAttachment / sendSenderAction',
  },
  {
    id: 'messaging.listConversations',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/conversations$`),
    note: 'getConversationMessages / getAllPageConversations',
  },

  // ── Page publishing (features-level) ────────────────────────────────────
  {
    id: 'pages.publishFeed',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/feed$`),
    note: 'publishSocialPost — text / link post',
  },
  {
    id: 'pages.publishPhoto',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/photos$`),
    note: 'publishSocialPost — image post + carousel children',
  },
  {
    id: 'pages.publishVideo',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/videos$`),
    note: 'publishSocialPost — video post',
  },
  {
    id: 'pages.listPosts',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/posts$`),
    note: 'fetchPageMedia',
  },

  // ── WhatsApp Cloud ──────────────────────────────────────────────────────
  {
    id: 'whatsapp.sendMessage',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/messages$`),
    note: 'text / media / template / interactive',
  },
  {
    id: 'whatsapp.listTemplates',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/message_templates$`),
    note: 'WhatsAppCloudService.listTemplates',
  },
  {
    id: 'whatsapp.createTemplate',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/message_templates$`),
    note: 'WhatsAppCloudService.createTemplate',
  },
  {
    id: 'whatsapp.deleteTemplate',
    method: 'DELETE',
    host: 'facebook',
    match: new RegExp(`^/${NODE}/message_templates$`),
    note: 'WhatsAppCloudService.deleteTemplate',
  },

  // ── Instagram (graph.instagram.com) ─────────────────────────────────────
  {
    id: 'instagram.createMedia',
    method: 'POST',
    host: 'instagram',
    match: new RegExp(`^/${NODE}/media$`),
    note: 'publishSocialPost — IG container + carousel children',
  },
  {
    id: 'instagram.publishMedia',
    method: 'POST',
    host: 'instagram',
    match: new RegExp(`^/${NODE}/media_publish$`),
    note: 'publishSocialPost — IG publish',
  },
  {
    id: 'instagram.getSenderProfile',
    method: 'GET',
    host: 'instagram',
    match: new RegExp(`^/${NODE}$`),
    note: 'fetchSenderProfile (name,username) + container status polling',
  },

  // ── Generic node read/write/delete (MUST BE LAST) ───────────────────────
  //
  // `GET /{id}` covers a lot: getCampaign, getAd, getAdSet, getCreative,
  // getAdPermalink, the page lookup with instagram_business_account, the
  // post-exists check. Discriminating them needs the `fields` query param, not
  // the path — the fake does that when it builds a response. Ordering matters:
  // these are last so the specific matchers above win.
  {
    id: 'node.get',
    method: 'GET',
    host: 'facebook',
    match: new RegExp(`^/${NODE}$`),
    note: 'getCampaign / getAd / getAdSet / getCreative / page + IG account lookup',
  },
  {
    id: 'node.update',
    method: 'POST',
    host: 'facebook',
    match: new RegExp(`^/${NODE}$`),
    note: 'updateCampaign / updateAdSet / updateAd',
  },
  {
    id: 'node.delete',
    method: 'DELETE',
    host: 'facebook',
    match: new RegExp(`^/${NODE}$`),
    note: 'deleteCampaign / deleteAdSet / deleteAd / deleteAdCreative / deleteSocialPost',
  },
];

/** Look up an endpoint by id. */
export function getEndpointById(id: string): GraphEndpoint | undefined {
  return GRAPH_ENDPOINTS.find((e) => e.id === id);
}
