import type { VerticalConfig } from '../types.js';
import { classify } from './classify.js';
import { aestheticClinicObjectionHandlers } from './objection-handlers.js';
import { pickOfferStrategy } from './pick-offer-strategy.js';
import { rankServices } from './rank-services.js';
import {
  renderOfferCopy,
  renderServiceCopy,
  staticOfferCopy,
  staticServiceCopy,
} from './render-copy.js';
import { selectServices } from './select-services.js';

export const aestheticClinicConfig: VerticalConfig = {
  vertical: 'aesthetic_clinic',
  // v3: LLM-first service selection (`selectServices`) is now the primary
  // ranker — the model reads the real menu and applies the spec's selection
  // rules directly, instead of the brittle keyword taxonomy + scoring (kept as
  // the no-API-key fallback). v2 fixed the non-surgical-facelift mis-tag; v3
  // bumps again so every stored profile reclassifies through the LLM picker.
  version: 'aesthetic_clinic@v3',
  classify,
  selectServices,
  rankServices,
  pickOfferStrategy,
  renderServiceCopy,
  renderOfferCopy,
  staticServiceCopy,
  staticOfferCopy,
  objectionHandlers: aestheticClinicObjectionHandlers,
};

export { aestheticClinicObjectionHandlers } from './objection-handlers.js';
export { heuristicClassify } from './classify.js';
export { extractPriceCents, taxonomiseService } from './service-taxonomy.js';
export { deriveClinicType, type ClinicType } from './derive-clinic-type.js';
export { deriveOutcomeTitle } from './render-copy.js';
export { selectServices } from './select-services.js';
