/**
 * Browser-safe re-export of the campaign content kit.
 *
 * These are PURE helpers (no node deps) that the composer + live preview need
 * as runtime VALUES — the "what actually sends" core shared with the server
 * sender so the preview is byte-for-byte the delivered message. They come from
 * the dedicated `@borradh-workspace/features/campaigns/content` subpath (NOT
 * the node-heavy campaigns barrel), so importing them never drags database/env/
 * ai into the browser bundle.
 */
export {
  CANONICAL_WHATSAPP_TEMPLATE,
  WHATSAPP_STOP_LINE,
  type CampaignWhatsappTemplateAtom,
  type RenderCampaignEmailHtmlOptions,
  type ResolvedCampaignWhatsappTemplate,
  fillWhatsappTemplate,
  renderCampaignEmailHtml,
  resolveCampaignWhatsappTemplate,
} from '@borradh-workspace/features/campaigns/content';
