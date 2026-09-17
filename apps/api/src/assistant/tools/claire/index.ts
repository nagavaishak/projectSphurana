/**
 * Window-6 Claire chat creation tools.
 *
 * Wires the recommendation engine + draft-state services into the assistant
 * chat via the `defineTool` factory. Tools fall into five groups:
 *
 *   1. recommend_*  — fetch ranked picks from the business profile
 *   2. set_pending_ad_* / set_pending_offer_* — per-field draft mutations
 *   3. show_*_preview — emit the Window-7 preview-card payload
 *   4. publish_* / save_*_draft — terminal actions tied to preview buttons
 *   5. resolve_disagreement — captures the operator's response to the
 *      classifier-disagreement system note
 *
 * Tool name shape: `claire_<action>` produced by `defineTool`. The chat
 * controller's catalogue alias map also registers the bare action name so
 * skill `toolNames: ['recommendServiceForAds', ...]` arrays resolve
 * without forcing the `claire_` prefix.
 *
 * Preview card payload shape (locked with Window 7):
 *   { type: 'preview_card', kind: 'ad' | 'offer', draftId, state }
 */

import type { ToolDefinition } from '../../tool-factory/index.js';

import { getAlternativeRecommendationTool } from './get-alternative-recommendation.tool.js';
import { publishAdTool } from './publish-ad.tool.js';
import { publishOfferTool } from './publish-offer.tool.js';
import { recommendOfferForServiceTool } from './recommend-offer-for-service.tool.js';
import { recommendServiceForAdsTool } from './recommend-service-for-ads.tool.js';
import { resolveDisagreementTool } from './resolve-disagreement.tool.js';
import { saveAdDraftTool } from './save-ad-draft.tool.js';
import { saveOfferDraftTool } from './save-offer-draft.tool.js';
import { setPendingAdBudgetTool } from './set-pending-ad-budget.tool.js';
import { setPendingAdCaptionTool } from './set-pending-ad-caption.tool.js';
import { setPendingAdCopyTool } from './set-pending-ad-copy.tool.js';
import { setPendingAdCreativeTool } from './set-pending-ad-creative.tool.js';
import { setPendingAdHeadlineTool } from './set-pending-ad-headline.tool.js';
import { setPendingAdPriceTool } from './set-pending-ad-price.tool.js';
import { setPendingAdScheduleTool } from './set-pending-ad-schedule.tool.js';
import { setPendingAdServiceTool } from './set-pending-ad-service.tool.js';
import { setPendingAdTargetingTool } from './set-pending-ad-targeting.tool.js';
import { setPendingOfferCodeTool } from './set-pending-offer-code.tool.js';
import { setPendingOfferIntroPriceTool } from './set-pending-offer-intro-price.tool.js';
import { setPendingOfferLocationsTool } from './set-pending-offer-locations.tool.js';
import { setPendingOfferNameTool } from './set-pending-offer-name.tool.js';
import { setPendingOfferRedemptionRulesTool } from './set-pending-offer-redemption-rules.tool.js';
import { setPendingOfferServiceTool } from './set-pending-offer-service.tool.js';
import { setPendingOfferValidityTool } from './set-pending-offer-validity.tool.js';
import { showAdPreviewTool } from './show-ad-preview.tool.js';
import { showOfferPreviewTool } from './show-offer-preview.tool.js';

export const claireTools: ToolDefinition[] = [
  // recommend_*
  recommendServiceForAdsTool,
  recommendOfferForServiceTool,
  getAlternativeRecommendationTool,

  // set_pending_ad_*
  setPendingAdServiceTool,
  setPendingAdHeadlineTool,
  setPendingAdCaptionTool,
  setPendingAdCopyTool,
  setPendingAdCreativeTool,
  setPendingAdTargetingTool,
  setPendingAdPriceTool,
  setPendingAdScheduleTool,
  setPendingAdBudgetTool,

  // set_pending_offer_*
  setPendingOfferServiceTool,
  setPendingOfferIntroPriceTool,
  setPendingOfferValidityTool,
  setPendingOfferNameTool,
  setPendingOfferCodeTool,
  setPendingOfferLocationsTool,
  setPendingOfferRedemptionRulesTool,

  // preview / publish / save
  showAdPreviewTool,
  showOfferPreviewTool,
  publishAdTool,
  publishOfferTool,
  saveAdDraftTool,
  saveOfferDraftTool,

  // disagreement
  resolveDisagreementTool,
];

export {
  getAlternativeRecommendationTool,
  publishAdTool,
  publishOfferTool,
  recommendOfferForServiceTool,
  recommendServiceForAdsTool,
  resolveDisagreementTool,
  saveAdDraftTool,
  saveOfferDraftTool,
  setPendingAdBudgetTool,
  setPendingAdCaptionTool,
  setPendingAdCopyTool,
  setPendingAdCreativeTool,
  setPendingAdHeadlineTool,
  setPendingAdPriceTool,
  setPendingAdScheduleTool,
  setPendingAdServiceTool,
  setPendingAdTargetingTool,
  setPendingOfferCodeTool,
  setPendingOfferIntroPriceTool,
  setPendingOfferLocationsTool,
  setPendingOfferNameTool,
  setPendingOfferRedemptionRulesTool,
  setPendingOfferServiceTool,
  setPendingOfferValidityTool,
  showAdPreviewTool,
  showOfferPreviewTool,
};
