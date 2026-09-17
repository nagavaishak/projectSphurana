/**
 * Schema-validated fixture factories for the conversations-domain projections.
 *
 * Each factory is built with `defineFixture(schema, base)`, so the base object
 * is `schema.parse`d at module load — it fails loudly if it ever drifts from the
 * contract. Component/integration tests build data from these so mocks can't
 * silently diverge from what the API actually returns.
 */
import {
  type AssistantRecommendationResponse,
  type BusinessProfileResponse,
  type ConversationMessageResponse,
  type ConversationResponse,
  assistantRecommendationSchema,
  businessProfileSchema,
  conversationMessageSchema,
  conversationSchema,
  defineFixture,
} from '@borradh-workspace/contracts';

const ISO = '2026-07-10T12:00:00.000Z';

export const aConversation = defineFixture<typeof conversationSchema>(
  conversationSchema,
  {
    id: 'conv_1',
    organizationId: 'org_1',
    metaAdsPageId: null,
    whatsappAccountId: null,
    externalUserId: 'psid_1',
    externalUserName: 'Ada Lovelace',
    externalUserAvatar: null,
    platform: 'facebook_messenger',
    status: 'bot_handling',
    metadata: { name: 'Ada', bookingInterest: true },
    version: 0,
    assignedToId: null,
    leadId: null,
    // The branch this conversation is about. Null is the honest default: it
    // means "never determined", which is what a fixture with no ad and no
    // single-branch org resolves to.
    locationId: null,
    lastMessageAt: ISO,
    closedAt: null,
    createdAt: ISO,
    updatedAt: ISO,
  } satisfies ConversationResponse
);

export const aConversationMessage = defineFixture<
  typeof conversationMessageSchema
>(conversationMessageSchema, {
  id: 'msg_1',
  conversationId: 'conv_1',
  role: 'user',
  content: 'I want to book an appointment',
  messageType: 'text',
  externalMessageId: null,
  origin: 'live',
  metadata: null,
  sentAt: ISO,
  deliveredAt: ISO,
  readAt: null,
  createdAt: ISO,
} satisfies ConversationMessageResponse);

export const aRecommendation = defineFixture<
  typeof assistantRecommendationSchema
>(assistantRecommendationSchema, {
  id: 'rec_1',
  organizationId: 'org_1',
  kind: 'content_no_post_14_days',
  title: "Haven't posted in 14 days",
  body: 'Post something fresh to stay top of mind.',
  primaryAction: {
    label: 'Create a post',
    type: 'navigate',
    target: '/content',
  },
  state: 'active',
  priority: 10,
  metadata: { conversationId: 'conv_1' },
  createdAt: ISO,
  updatedAt: ISO,
  actionedAt: null,
  dismissedAt: null,
  expiresAt: null,
} satisfies AssistantRecommendationResponse);

export const aBusinessProfile = defineFixture<typeof businessProfileSchema>(
  businessProfileSchema,
  {
    id: 'bp_1',
    organizationId: 'org_1',
    vertical: 'aesthetic_clinic',
    retentionModel: 'rebooking',
    commitmentLevel: 'planned',
    marketPosition: 'at',
    axesConfidence: 0.82,
    axesReasoning: 'Rebooking cadence inferred from services.',
    classifierAxes: {
      retentionModel: 'rebooking',
      commitmentLevel: 'planned',
      marketPosition: 'at',
      confidence: 0.82,
      reasoning: 'inferred',
    },
    overriddenAxes: null,
    disagreement: null,
    rankedServices: [],
    inputHash: 'hash_1',
    classifiedAt: ISO,
    classifierVersion: 'v2',
    verticalMetadata: {},
    createdAt: ISO,
    updatedAt: ISO,
  } satisfies BusinessProfileResponse
);
