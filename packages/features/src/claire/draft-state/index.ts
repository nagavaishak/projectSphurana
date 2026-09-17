// Ad drafts
export {
  getOrCreateDraftAdSchema,
  type GetOrCreateDraftAdInput,
  updateDraftAdSchema,
  type UpdateDraftAdInput,
  promoteDraftAdSchema,
  type PromoteDraftAdInput,
} from './draft-ad.schema.js';

export {
  getOrCreateDraftAd,
  type GetOrCreateDraftAdResult,
  type DraftAdWithServices,
} from './get-or-create-draft-ad.service.js';

export {
  updateDraftAd,
  type UpdateDraftAdResult,
  type UpdateDraftAdResponse,
} from './update-draft-ad.service.js';

export {
  promoteDraftAd,
  type PromoteDraftAdResult,
  type PromoteDraftAdResponse,
} from './promote-draft-ad.service.js';

// Offer drafts
export {
  getOrCreateDraftOfferSchema,
  type GetOrCreateDraftOfferInput,
  updateDraftOfferSchema,
  type UpdateDraftOfferInput,
  promoteDraftOfferSchema,
  type PromoteDraftOfferInput,
} from './draft-offer.schema.js';

export {
  getOrCreateDraftOffer,
  type GetOrCreateDraftOfferResult,
  type DraftOfferWithLinks,
} from './get-or-create-draft-offer.service.js';

export {
  updateDraftOffer,
  type UpdateDraftOfferResult,
  type UpdateDraftOfferResponse,
} from './update-draft-offer.service.js';

export {
  promoteDraftOffer,
  type PromoteDraftOfferResult,
} from './promote-draft-offer.service.js';

// Defaults helpers
export {
  pickDefaultRankedService,
  buildDefaultAdName,
  buildDefaultOfferName,
  buildDefaultValidity,
} from './draft-defaults.js';
