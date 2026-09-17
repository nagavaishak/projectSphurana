// Offers feature barrel export

// Services
export {
  // remove-offer-location
  removeOfferLocation,
  removeOfferLocationSchema,
  type RemoveOfferLocationInput,
  type RemoveOfferLocationResult,
  // add-offer-locations
  addOfferLocations,
  addOfferLocationsSchema,
  type AddOfferLocationsInput,
  type AddOfferLocationsResult,
  // assert-service-matches-offer
  assertServiceMatchesOffer,
  assertServiceMatchesOfferSchema,
  type AssertServiceMatchesOfferInput,
  type AssertServiceMatchesOfferResult,
  // create-offer
  createOffer,
  createOfferBaseSchema,
  createOfferSchema,
  type CreateOfferInput,
  type CreateOfferResult,
  // get-offer
  getOffer,
  getOfferSchema,
  type GetOfferInput,
  type GetOfferResult,
  type OfferWithServices,
  // list-offers
  listOffers,
  listOffersSchema,
  type ListOffersInput,
  type ListOffersResult,
  type ListOffersResponse,
  // update-offer
  updateOffer,
  updateOfferBaseSchema,
  updateOfferSchema,
  type UpdateOfferInput,
  type UpdateOfferResult,
  // delete-offer
  deleteOffer,
  deleteOfferSchema,
  type DeleteOfferInput,
  type DeleteOfferResult,
} from './services/index.js';

// Models
export type {
  Offer,
  NewOffer,
  OfferService,
  NewOfferService,
  OfferLocation,
  NewOfferLocation,
  OfferState,
  OfferDiscountType,
} from './models/index.js';
export { withdrawOffers } from './shared/withdraw-offers.js';
