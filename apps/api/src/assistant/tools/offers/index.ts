/**
 * Factory-shaped offers tools (Track C-08, Phase 2).
 *
 * 4 new tools defined here; the 5th (`listOffers`) reuses the existing
 * `context_listOffers` from `tools/context/list-offers.tool.ts`. The
 * controller's catalogue alias maps the bare `listOffers` name to that
 * existing tool, so the `manage-offers` skill's `toolNames: ['listOffers',
 * 'getOfferPerformance', 'createOffer', 'extendOffer', 'expireOffer']`
 * resolves correctly without duplication.
 *
 * Tool name shape produced by the factory: `offers_<action>`. Skill modules
 * may reference either the canonical name or the unprefixed alias; the
 * controller's `registerTool` claims both (the prefixed name always; the
 * bare alias only if no other tool has claimed it).
 */

import type { ToolDefinition } from '../../tool-factory/index.js';
import { createOfferTool } from './create-offer.tool.js';
import { expireOfferTool } from './expire-offer.tool.js';
import { extendOfferTool } from './extend-offer.tool.js';
import { getOfferPerformanceTool } from './get-offer-performance.tool.js';
import { suggestIntroOfferTool } from './suggest-intro-offer.tool.js';

export const offersTools: ToolDefinition[] = [
  getOfferPerformanceTool,
  createOfferTool,
  extendOfferTool,
  expireOfferTool,
  suggestIntroOfferTool,
];

export {
  createOfferTool,
  expireOfferTool,
  extendOfferTool,
  getOfferPerformanceTool,
  suggestIntroOfferTool,
};
