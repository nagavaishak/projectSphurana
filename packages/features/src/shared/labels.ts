/**
 * Re-exports all label constants and enum arrays from @borradh-workspace/labels.
 *
 * This file exists to break the direct dependency between api-client and database.
 * api-client imports labels from here (features/shared), not from database directly.
 *
 * Runtime label/value records live in `@borradh-workspace/labels` — a leaf
 * package with zero drizzle/postgres deps, safe to bundle into web/mobile.
 *
 * Entity types (Lead, Appointment, Asset, etc.) are derived from drizzle schema
 * via `$inferSelect`, so those `export type` re-exports point at
 * `@borradh-workspace/database/schema`. `export type` is erased at compile time
 * (with `isolatedModules: true`), so it produces no runtime import and the
 * bundler never resolves into /schema.
 */

// =============================================================================
// APPOINTMENTS
// =============================================================================
export {
  appointmentStatusLabels,
  appointmentStatusValues,
  appointmentSourceLabels,
  appointmentSourceValues,
  appointmentColorLabels,
  appointmentColorValues,
} from '@borradh-workspace/labels';

export type {
  AppointmentStatus,
  AppointmentSource,
  AppointmentColor,
} from '@borradh-workspace/database/schema';

// =============================================================================
// DEPOSITS
// =============================================================================
export {
  depositAggregationLabels,
  depositAggregationValues,
  depositBasisLabels,
  depositBasisValues,
  depositStatusLabels,
  depositStatusValues,
  servicePaymentPolicyLabels,
  servicePaymentPolicyValues,
} from '@borradh-workspace/labels';

export type {
  DepositStatus,
  AppointmentDeposit,
  StripeConnectIntegration,
} from '@borradh-workspace/database/schema';

// =============================================================================
// ASSETS
// =============================================================================
export {
  assetTypeLabels,
  assetTypeValues,
  assetSourceLabels,
  assetSourceValues,
  placeholderTypeLabels,
  placeholderTypeValues,
  assetAnalysisStatusLabels,
  assetAnalysisStatusValues,
  assetContentTypeLabels,
  assetContentTypeValues,
  assetContentTypeTagLabels,
  assetContentTypeTagValues,
  contentTypeToTagMap,
} from '@borradh-workspace/labels';

export type {
  AssetType,
  AssetSource,
  Asset,
  PlaceholderType,
  AssetAnalysisStatus,
  AssetContentType,
  AssetContentTypeTag,
  AssetAnalysis,
  AssetAnalysisResult,
} from '@borradh-workspace/database/schema';

// =============================================================================
// BILLING
// =============================================================================
export {
  subscriptionStatusLabels,
  subscriptionStatusValues,
  creditTransactionTypeLabels,
  creditTransactionTypeValues,
  creditChannelLabels,
  creditChannelValues,
  invoiceStatusLabels,
  invoiceStatusValues,
} from '@borradh-workspace/labels';

export type {
  SubscriptionStatus,
  CreditTransactionType,
  CreditChannel,
  InvoiceStatus,
  Subscription,
  CreditBalance,
  CreditTransaction,
  Invoice,
} from '@borradh-workspace/database/schema';

// =============================================================================
// BOOKING ACCOUNTS
// =============================================================================
export {
  bookingProviderLabels,
  bookingProviderValues,
} from '@borradh-workspace/labels';

export type { BookingProvider } from '@borradh-workspace/database/schema';

// =============================================================================
// EMAIL ACCOUNTS
// =============================================================================
export {
  emailProviderLabels,
  emailProviderValues,
} from '@borradh-workspace/labels';

export type { EmailProvider } from '@borradh-workspace/database/schema';

// =============================================================================
// GRAPHICS
// =============================================================================
export {
  graphicStatusLabels,
  graphicStatusValues,
  aspectRatioLabels,
  aspectRatioValues,
  graphicUsageTypeLabels,
  graphicUsageTypeValues,
  // Graphic generation category (nano-banana generate flow).
  graphicCategoryLabels,
  graphicCategoryValues,
} from '@borradh-workspace/labels';

export type {
  GraphicStatus,
  AspectRatio,
  Graphic,
  GraphicOutput,
  GraphicUsageType,
} from '@borradh-workspace/database/schema';

export type { GraphicCategory } from '@borradh-workspace/labels';

// =============================================================================
// INTEGRATIONS
// =============================================================================
export {
  integrationTypeLabels,
  integrationTypeValues,
} from '@borradh-workspace/labels';

export type {
  IntegrationType,
  OrganizationIntegration,
} from '@borradh-workspace/database/schema';

// =============================================================================
// LEADS
// =============================================================================
export {
  leadStatusLabels,
  leadStatusValues,
  pipelineLeadStatusValues,
  leadStatusLabel,
  normalizeLeadStage,
  leadSourceLabels,
  leadSourceValues,
  consentSourceLabels,
  consentSourceValues,
} from '@borradh-workspace/labels';

export type {
  LeadStatus,
  LeadSource,
  ConsentSource,
} from '@borradh-workspace/database/schema';

// =============================================================================
// META ADS & CAMPAIGNS
// =============================================================================
export {
  metaCampaignStatusLabels,
  metaCampaignStatusValues,
  metaCampaignObjectiveLabels,
  metaCampaignObjectiveValues,
  metaAdStatusLabels,
  metaAdStatusValues,
  metaCallToActionLabels,
  metaCallToActionValues,
  followUpTypeLabels,
  followUpTypeValues,
  adPlacementLabels,
  adPlacementValues,
  conversionDestinationLabels,
  conversionDestinationValues,
  messagingDestinationLabels,
  messagingDestinationValues,
} from '@borradh-workspace/labels';

export type {
  MetaCampaignStatus,
  MetaCampaignObjective,
  MetaAdStatus,
  MetaCallToAction,
  MetaTargeting,
  MetaAd,
  MetaAdService,
  FollowUpType,
  AdPlacement,
  ConversionDestination,
  MessagingDestination,
} from '@borradh-workspace/database/schema';

// =============================================================================
// ORGANIZATION
// =============================================================================
export {
  onboardingTaskLabels,
  onboardingTaskValues,
  businessTypeLabels,
  businessTypeValues,
  countryCodeLabels,
  countryCodeValues,
  contentStyleTemplateLabels,
  contentStyleTemplateValues,
  stylePreferenceLabels,
  stylePreferenceValues,
  primaryCalendarTypeLabels,
  primaryCalendarTypeValues,
  teamPermissionLevelLabels,
  teamPermissionLevelValues,
  permissionLevelToRole,
  roleToPermissionLevel,
} from '@borradh-workspace/labels';

export type {
  OnboardingTask,
  BusinessType,
  CountryCode,
  ContentStyleTemplate,
  StylePreference,
  PrimaryCalendarType,
} from '@borradh-workspace/database/schema';

export type { TeamPermissionLevel } from '@borradh-workspace/labels';

// Organization entity types (curated subset - excludes apiKey and other sensitive fields)
export type {
  Organization,
  OrganizationMember,
  OrganizationRole,
} from '../organizations/models/index.js';

// =============================================================================
// SEQUENCES
// =============================================================================
export {
  sequenceStepTypeLabels,
  sequenceStepTypeValues,
  sequenceVersionChangeTypeLabels,
  sequenceVersionChangeTypeValues,
  sequenceExecutionStatusLabels,
  sequenceExecutionStatusValues,
} from '@borradh-workspace/labels';

export type {
  SequenceStepType,
  SequenceVersionChangeType,
  SequenceExecutionStatus,
} from '@borradh-workspace/database/schema';

// =============================================================================
// SOCIAL POSTS
// =============================================================================
export {
  socialPostStatusLabels,
  socialPostStatusValues,
  socialPostMediaTypeLabels,
  socialPostMediaTypeValues,
  socialPlatformLabels,
  socialPlatformValues,
} from '@borradh-workspace/labels';

export type {
  SocialPostStatus,
  SocialPostMediaType,
  SocialPlatform,
  SocialPost,
  PlatformSettings,
  PlatformPublishResult,
} from '@borradh-workspace/database/schema';

// =============================================================================
// TRAINING
// =============================================================================
export {
  trainingCategoryLabels,
  trainingCategoryValues,
} from '@borradh-workspace/labels';

export type {
  TrainingCategory,
  TrainingVideo,
  UserVideoProgress,
} from '@borradh-workspace/database/schema';

// =============================================================================
// VIDEOS
// =============================================================================
export {
  videoStatusLabels,
  videoStatusValues,
  videoProcessingStageLabels,
  videoProcessingStageValues,
  videoUsageTypeLabels,
  videoUsageTypeValues,
} from '@borradh-workspace/labels';

export type {
  ClipType,
  VideoStatus,
  VideoProcessingStage,
  Video,
  VideoDraftConfig,
  BRollClipConfig,
  VideoUsageType,
} from '@borradh-workspace/database/schema';

// AI voice IDs (from labels, not schema — no Drizzle dependency)
export {
  aiVoiceIdLabels,
  aiVoiceIdValues,
} from '@borradh-workspace/labels';

// =============================================================================
// VOICE
// =============================================================================
export {
  voiceCallStatusLabels,
  voiceCallStatusValues,
  voiceCallOutcomeLabels,
  voiceCallOutcomeValues,
  voiceSentimentLabels,
  voiceSentimentValues,
} from '@borradh-workspace/labels';

export type {
  VoiceCallStatus,
  VoiceCallOutcome,
  VoiceSentiment,
  VoiceScript,
} from '@borradh-workspace/database/schema';

// =============================================================================
// PAYMENTS
// =============================================================================
export {
  paymentStatusLabels,
  paymentStatusValues,
} from '@borradh-workspace/labels';

export type { PaymentStatus } from '@borradh-workspace/database/schema';

// =============================================================================
// LEAD FORMS
// =============================================================================
export {
  leadFormStatusLabels,
  leadFormStatusValues,
  leadFormFieldTypeLabels,
  leadFormFieldTypeValues,
  leadFormFollowUpChannelLabels,
  leadFormFollowUpChannelValues,
  defaultLeadFormQuestions,
  // Messenger auto-start: which field sets let Meta open the chat by itself.
  messengerEligibleQuestionTypes,
  messengerDisqualifyingQuestionTypes,
  isMessengerEligible,
  // Meta's question-type vocabulary differs from ours (DATE_OF_BIRTH is DOB).
  toMetaQuestionType,
  fromMetaQuestionType,
} from '@borradh-workspace/labels';

export type {
  LeadFormDefaultQuestion,
  MessengerEligibleQuestionType,
} from '@borradh-workspace/labels';

export type {
  LeadFormStatus,
  LeadFormFieldType,
  LeadFormFollowUpChannel,
  LeadForm,
  LeadFormQuestion,
} from '@borradh-workspace/database/schema';

// =============================================================================
// PRACTITIONERS
// =============================================================================
export type {
  Practitioner,
  PractitionerLocation,
  PractitionerService,
  PractitionerSocialLinks,
  WorkingHours,
} from '@borradh-workspace/database/schema';

// =============================================================================
// ORGANIZATION SERVICES
// =============================================================================
export {
  serviceCategoryLabels,
  serviceCategoryValues,
} from '@borradh-workspace/labels';

export type {
  ServiceCategory,
  OrganizationService,
} from '@borradh-workspace/database/schema';

// =============================================================================
// ORGANIZATION LOCATIONS
// =============================================================================
export type {
  OrganizationLocation,
  LocationOpeningHours,
  OrganizationLocationOpeningHoursException,
} from '@borradh-workspace/database/schema';

// =============================================================================
// PHONE NUMBERS
// =============================================================================
export {
  phoneNumberStatusLabels,
  phoneNumberStatusValues,
  phoneNumberProviderLabels,
  phoneNumberProviderValues,
} from '@borradh-workspace/labels';

export type {
  PhoneNumberStatus,
  PhoneNumberProvider,
  PhoneNumber,
} from '@borradh-workspace/database/schema';

// =============================================================================
// OUTRO STYLES
// =============================================================================
export {
  outroStyleLabels,
  outroStyleValues,
} from '@borradh-workspace/labels';

export type { OutroStyle } from '@borradh-workspace/database/schema';

// =============================================================================
// CHATBOTS
// =============================================================================
export {
  chatbotGoalLabels,
  chatbotGoalValues,
  chatbotToneLabels,
  chatbotToneValues,
} from '@borradh-workspace/labels';

export type {
  ChatbotGoal,
  ChatbotTone,
} from '@borradh-workspace/database/schema';

// =============================================================================
// CONVERSATIONS
// =============================================================================
export {
  conversationStatusLabels,
  conversationStatusValues,
  messageRoleLabels,
  messageRoleValues,
  messageTypeLabels,
  messageTypeValues,
  messagingPlatformLabels,
  messagingPlatformValues,
} from '@borradh-workspace/labels';

export type {
  ConversationStatus,
  MessageRole,
  MessageType,
  MessagingPlatform,
  Conversation,
  ConversationMessage,
} from '@borradh-workspace/database/schema';

// =============================================================================
// LEAD IMPORT OPTIONS (defined here to avoid pulling in schema → database → postgres)
// Values must stay in sync with import-leads.schema.ts
// =============================================================================
export const deduplicateByValues = [
  'email',
  'phone',
  'email_and_phone',
  'none',
] as const;

export type DeduplicateBy = (typeof deduplicateByValues)[number];

export const onDuplicateValues = ['skip', 'update', 'create_new'] as const;

export type OnDuplicate = (typeof onDuplicateValues)[number];

// =============================================================================
// FACE GROUPS
// =============================================================================
export {
  faceGroupAssetRoleLabels,
  faceGroupAssetRoleValues,
} from '@borradh-workspace/labels';

export type {
  FaceGroupAssetRole,
  FaceGroup,
  FaceGroupAsset,
} from '@borradh-workspace/database/schema';

// =============================================================================
// OFFERS
// =============================================================================
export {
  offerStateLabels,
  offerStateValues,
  offerDiscountTypeLabels,
  offerDiscountTypeValues,
} from '@borradh-workspace/labels';

export type {
  OfferState,
  OfferDiscountType,
  Offer,
  NewOffer,
  OfferService,
  NewOfferService,
  OfferLocation,
  NewOfferLocation,
} from '@borradh-workspace/database/schema';

// =============================================================================
// ASSISTANT / KNOWLEDGE BASE
// =============================================================================
export {
  assistantMessageRoleLabels,
  assistantMessageRoleValues,
  knowledgeEntryTypeLabels,
  knowledgeEntryTypeValues,
  knowledgeSourceLabels,
  knowledgeSourceValues,
  assistantConversationStatusLabels,
  assistantConversationStatusValues,
  assistantRecommendationKindLabels,
  assistantRecommendationKindValues,
  assistantRecommendationStateLabels,
  assistantRecommendationStateValues,
} from '@borradh-workspace/labels';

export type {
  AssistantMessageRole,
  KnowledgeEntryType,
  KnowledgeSource,
  KnowledgeEntry,
  AssistantConversation,
  AssistantMessage,
  AssistantConversationStatus,
  AssistantRecommendation,
  AssistantRecommendationKind,
  AssistantRecommendationState,
  AssistantPrimaryAction,
} from '@borradh-workspace/database/schema';

// Action type labels live in @borradh-workspace/labels alongside other assistant enums
export {
  assistantActionTypeLabels,
  assistantActionTypeValues,
} from '@borradh-workspace/labels';

export type { AssistantActionType } from '@borradh-workspace/labels';

// =============================================================================
// CLAIRE (v3 tool-factory infrastructure)
// =============================================================================
export {
  claireConfirmationActionLabels,
  claireConfirmationActionValues,
} from '@borradh-workspace/labels';

export type { ClaireConfirmationAction } from '@borradh-workspace/labels';
export type { ClaireConfirmationToken } from '@borradh-workspace/database/schema';

// =============================================================================
// CLAIRE — RECOMMENDATION ENGINE (business_profile + 3-axis classifier)
// =============================================================================
export {
  businessVerticalLabels,
  businessVerticalValues,
  retentionModelLabels,
  retentionModelValues,
  commitmentLevelLabels,
  commitmentLevelValues,
  marketPositionLabels,
  marketPositionValues,
  offerStrategyLabels,
  offerStrategyValues,
} from '@borradh-workspace/labels';

export type {
  BusinessVertical,
  RetentionModel,
  CommitmentLevel,
  MarketPosition,
  OfferStrategy,
} from '@borradh-workspace/labels';

export type {
  BusinessProfile,
  NewBusinessProfile,
  RankedService,
  AxisSnapshot,
  ClassifierAxes,
  OverriddenAxes,
  Disagreement,
} from '@borradh-workspace/database/schema';

// =============================================================================
// CONTENT BATCHES (monthly organic graphics + videos with accept/regenerate)
// =============================================================================
export {
  contentBatchStatusLabels,
  contentBatchStatusValues,
  contentBatchItemKindLabels,
  contentBatchItemKindValues,
  contentBatchItemReviewStatusLabels,
  contentBatchItemReviewStatusValues,
  contentBatchItemMessageRoleLabels,
  contentBatchItemMessageRoleValues,
} from '@borradh-workspace/labels';

export type {
  ContentBatchStatus,
  ContentBatchItemKind,
  ContentBatchItemReviewStatus,
  ContentBatchItemMessageRole,
  ContentBatch,
  ContentItem,
  ContentItemMessage,
} from '@borradh-workspace/database/schema';

// =============================================================================
// USERS
// =============================================================================
// userColor* are the calendar tint palette. Currently assigned per-practitioner
// (see Practitioner.color) so colors stay unique within an organization.
export { userColorLabels, userColorValues } from '@borradh-workspace/labels';

export type { UserColor } from '@borradh-workspace/labels';
export type { User } from '@borradh-workspace/database/schema';

// =============================================================================
// API KEYS (defined in features, not database)
// =============================================================================
export { API_SCOPES, apiScopeValues } from '../api-keys/models/scopes.js';
export type { ApiScope } from '../api-keys/models/scopes.js';

// =============================================================================
// NOTIFICATIONS
// =============================================================================
export {
  notificationTypeLabels,
  notificationTypeValues,
  notificationScopeLabels,
  notificationScopeValues,
  notificationCategoryLabels,
  defaultNotificationPreferences,
  withPreferenceDefaults,
} from '@borradh-workspace/labels';

export type {
  NotificationType,
  NotificationScope,
  NotificationCategory,
  NotificationChannels,
  NotificationPreferencesData,
  ScopedCategoryPreference,
  ToggleCategoryPreference,
} from '@borradh-workspace/labels';

export type {
  Notification,
  NotificationPreference,
} from '@borradh-workspace/database/schema';

// =============================================================================
// SCHEDULING
// =============================================================================
export {
  timeOffTypeLabels,
  timeOffTypeValues,
  employmentTypeLabels,
  employmentTypeValues,
  wageCompensationTypeLabels,
  wageCompensationTypeValues,
  wageRegularHoursPerLabels,
  wageRegularHoursPerValues,
  wageOvertimeTypeLabels,
  wageOvertimeTypeValues,
  wageAutomationSettingLabels,
  wageAutomationSettingValues,
} from '@borradh-workspace/labels';

export type {
  TimeOffType,
  EmploymentType,
  WageCompensationType,
  WageRegularHoursPer,
  WageOvertimeType,
  WageAutomationSetting,
} from '@borradh-workspace/database/schema';

export type {
  BlockedTimeType,
  BlockedTime,
  BlockedTimeException,
  TimeOff,
  Shift,
  PractitionerWageConfig,
} from '@borradh-workspace/database/schema';

// =============================================================================
// MEMBERSHIPS
// =============================================================================
export {
  membershipPricingTypeLabels,
  membershipPricingTypeValues,
  membershipValidForLabels,
  membershipValidForValues,
  leadMembershipStatusLabels,
  leadMembershipStatusValues,
} from '@borradh-workspace/labels';

export type {
  MembershipPricingType,
  MembershipValidFor,
  LeadMembershipStatus,
} from '@borradh-workspace/labels';

export type {
  MembershipPlan,
  MembershipPlanService,
  LeadMembership,
} from '@borradh-workspace/database/schema';
// INVENTORY
// =============================================================================
export {
  productMeasureUnitLabels,
  productMeasureUnitValues,
  stockOrderStatusLabels,
  stockOrderStatusValues,
  stockOrderFeeTypeLabels,
  stockOrderFeeTypeValues,
  stockTakeStatusLabels,
  stockTakeStatusValues,
} from '@borradh-workspace/labels';

export type {
  ProductMeasureUnit,
  StockOrderStatus,
  StockOrderFeeType,
  StockTakeStatus,
} from '@borradh-workspace/labels';
// SALES / POS + GIFT CARDS (A3)
// =============================================================================
export {
  saleStatusLabels,
  saleStatusValues,
  saleTipTypeLabels,
  saleTipTypeValues,
  saleItemTypeLabels,
  saleItemTypeValues,
  salePaymentMethodLabels,
  salePaymentMethodValues,
  salePaymentStatusLabels,
  salePaymentStatusValues,
  saleFulfilmentMethodLabels,
  saleFulfilmentMethodValues,
  saleFulfilmentStatusLabels,
  saleFulfilmentStatusValues,
  giftCardTransactionTypeLabels,
  giftCardTransactionTypeValues,
  giftCardExpiryLabels,
  giftCardExpiryValues,
} from '@borradh-workspace/labels';

export type {
  SaleStatus,
  SaleTipType,
  SaleItemType,
  SalePaymentMethod,
  SalePaymentStatus,
  SaleFulfilmentMethod,
  SaleFulfilmentStatus,
  GiftCardTransactionType,
  GiftCardExpiry,
} from '@borradh-workspace/labels';

export type {
  Sale,
  SaleItem,
  SalePayment,
  GiftCard,
  GiftCardTransaction,
} from '@borradh-workspace/database/schema';

// =============================================================================
// TIMESHEETS
// =============================================================================
export {
  timeEntrySourceLabels,
  timeEntrySourceValues,
  timeEntryStatusLabels,
  timeEntryStatusValues,
} from '@borradh-workspace/labels';

export type {
  TimeEntrySource,
  TimeEntryStatus,
  TimeEntry,
  TimeEntryBreak,
} from '@borradh-workspace/database/schema';

// =============================================================================
// RESOURCES (rooms & equipment — resource scheduling)
// =============================================================================
export {
  MAX_RESOURCE_CATEGORIES,
  appointmentResourceSourceLabels,
  appointmentResourceSourceValues,
  resourceAssignmentModeLabels,
  resourceAssignmentModeValues,
  resourceCategoryKindLabels,
  resourceCategoryKindPluralLabels,
  resourceCategoryKindRequiresLabels,
  resourceCategoryKindSingularLabels,
  resourceCategoryKindValues,
  resourceCountLabel,
} from '@borradh-workspace/labels';

export type {
  AppointmentResource,
  Resource,
  ResourceAssignmentMode,
  ResourceCategory,
  ResourceCategoryKind,
} from '@borradh-workspace/database/schema';
