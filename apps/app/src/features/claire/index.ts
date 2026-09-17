// --- CA-4 foundation: tour runner, walkthroughs, walkthrough provider ---

export {
  ClaireTourRunner,
  startClaireTour,
  interpolateTourCopy,
  type TourAdvanceTrigger,
  type TourDefinition,
  type TourHandler,
  type TourPayload,
  type TourStep,
} from './tour-runner';

// Legacy `create_*` tour exports were removed in the Claire Creation
// Redesign — creation moved into chat. Add new onboarding/discovery tour
// exports here as they land.
export {} from './walkthroughs';

export {
  ClaireWalkthroughProvider,
  useWalkthroughDispatcher,
  useClaireWidgetState,
  type WalkthroughDispatcher,
  type WalkthroughHandler,
  type WalkthroughHandlers,
} from './lib';

// --- CA-5: widget components + recommendation/escalation api ---

export {
  ClaireWidgetRoot,
  ClaireLauncher,
  ClaireChatPanel,
  ClaireConversationList,
  ClaireRecommendationToast,
} from './components';

export * from './api';

// --- Claire recommendation engine — /ads/new field advisor ---

export {
  ClaireFieldAdvisorProvider,
  useClaireFieldAdvisor,
  ClaireFieldAdvisorCard,
  ClaireDisagreementFooter,
  ClaireOverridePanel,
  ClaireMarketPositionPrefix,
  type AdvisorContent,
  type AdvisorActionShape,
} from './field-advisor';

// --- Window 7 — Claire chat preview cards ---

export {
  AdPreviewCard,
  OfferPreviewCard,
  CreativePreview,
  asPreviewCardPayload,
  type AdPreviewCardState,
  type OfferPreviewCardState,
  type PreviewCardPayload,
} from './chat-preview';

// --- Window 8 — recommendation funnel telemetry (client) ---

export {
  trackRecommendationImpression,
  trackRecommendationAccepted,
  trackRecommendationDismissed,
  trackRecommendationEdited,
  trackRecommendationAbandoned,
  trackRecommendationPublished,
  type ClaireSurface,
  type ClaireRecommendationKind,
} from './telemetry';
