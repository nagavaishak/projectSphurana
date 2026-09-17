// First-half slide barrel (slides 1-7: website → intro_offer).
// The coordinator wires `export * from './index.pre'` into slides/index.ts
// alongside the second-half barrel.
export { AnalysisSlide, type AnalysisSlideProps } from './analysis-slide';
export {
  CampaignPitchSlide,
  type CampaignPitchAnswer,
  type CampaignPitchSlideProps,
} from './campaign-pitch-slide';
export {
  ContentSourceSlide,
  type ContentSourceSlideProps,
} from './content-source-slide';
export {
  ContentUploadSlide,
  type ContentUploadSlideProps,
} from './content-upload-slide';
export {
  IntroOfferSlide,
  type IntroOfferSlideProps,
} from './intro-offer-slide';
export { IntroSlide, type IntroSlideProps } from './intro-slide';
export {
  ServicePriceSlide,
  currencyForOnboardingSession,
  parsePriceToCents,
  type ServicePriceAnswer,
  type ServicePriceSlideProps,
} from './service-price-slide';
export {
  VerifyEmailSlide,
  type VerifyEmailSlideProps,
} from './verify-email-slide';
export { WebsiteSlide, type WebsiteSlideProps } from './website-slide';
