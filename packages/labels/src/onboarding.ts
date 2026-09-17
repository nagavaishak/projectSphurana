// Claire-guided onboarding flow (Typeform-style slide deck)

// Canonical slide keys, in flow order. `currentSlide` on onboarding_session
// stores one of these; the frontend maps keys to slide components. Order here
// is documentation — actual transitions are validated in the features service.
export const onboardingSlideLabels = {
  intro: 'Meet Claire',
  website: 'Share your website',
  verify_email: 'Verify your email',
  analysis: 'Brand analysis',
  content_source: 'Upload or stock content',
  content_upload: 'Upload your content',
  campaign_pitch: 'First campaign pitch',
  service_price: 'Service price',
  intro_offer: 'Intro offer',
  ad_picker: 'Pick your ads',
  video_picker: 'Pick your video',
  campaign_review: 'Campaign review',
  meta_connect: 'Connect Meta',
  campaign_live: 'Campaign live',
  test_chat: 'Test Claire',
  content_approval: 'Approve your content',
  mobile_app: 'Get the mobile app',
  whatsapp: 'Talk to Claire on WhatsApp',
} as const;

export const onboardingSlideValues = Object.keys(onboardingSlideLabels) as [
  keyof typeof onboardingSlideLabels,
  ...(keyof typeof onboardingSlideLabels)[],
];

export type OnboardingSlide = keyof typeof onboardingSlideLabels;

// Session lifecycle
export const onboardingSessionStatusLabels = {
  active: 'Active',
  completed: 'Completed',
  abandoned: 'Abandoned',
} as const;

export const onboardingSessionStatusValues = Object.keys(
  onboardingSessionStatusLabels
) as [
  keyof typeof onboardingSessionStatusLabels,
  ...(keyof typeof onboardingSessionStatusLabels)[],
];

export type OnboardingSessionStatus =
  keyof typeof onboardingSessionStatusLabels;

// Content source choice on the content_source slide
export const onboardingContentSourceLabels = {
  upload: 'Upload my own content',
  stock: 'Use stock images and videos',
} as const;

export const onboardingContentSourceValues = Object.keys(
  onboardingContentSourceLabels
) as [
  keyof typeof onboardingContentSourceLabels,
  ...(keyof typeof onboardingContentSourceLabels)[],
];

export type OnboardingContentSource =
  keyof typeof onboardingContentSourceLabels;
