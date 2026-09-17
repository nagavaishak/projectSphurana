// Second-half slide barrel (slides 8-16: ad_picker → whatsapp).
// The coordinator wires `export * from './index.post'` into slides/index.ts
// alongside the first-half barrel (index.pre.ts).
export { AdPickerSlide, type AdPickerSlideProps } from './ad-picker-slide';
export {
  CampaignLiveSlide,
  type CampaignLiveSlideProps,
} from './campaign-live-slide';
export {
  CampaignReviewSlide,
  type CampaignReviewSlideProps,
} from './campaign-review-slide';
export {
  ContentApprovalSlide,
  type ContentApprovalSlideProps,
} from './content-approval-slide';
export {
  MetaConnectSlide,
  type MetaConnectSlideProps,
} from './meta-connect-slide';
export { MobileAppSlide, type MobileAppSlideProps } from './mobile-app-slide';
export { TestChatSlide, type TestChatSlideProps } from './test-chat-slide';
export {
  VideoPickerSlide,
  type VideoPickerSlideProps,
} from './video-picker-slide';
export { WhatsappSlide, type WhatsappSlideProps } from './whatsapp-slide';
