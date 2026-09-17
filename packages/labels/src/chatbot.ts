/**
 * Chatbot enums - SOURCE OF TRUTH
 * Pure TypeScript - no Drizzle imports
 */

// Chatbot status labels
export const chatbotStatusLabels = {
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  archived: 'Archived',
} as const;

export const chatbotStatusValues = Object.keys(chatbotStatusLabels) as [
  keyof typeof chatbotStatusLabels,
  ...(keyof typeof chatbotStatusLabels)[],
];

export type ChatbotStatus = keyof typeof chatbotStatusLabels;

// Chatbot node type labels
export const chatbotNodeTypeLabels = {
  start: 'Start',
  send_message: 'Send Message',
  quick_reply: 'Quick Reply',
  condition: 'Condition',
  delay: 'Delay',
  collect_info: 'Collect Info',
  book_appointment: 'Book Appointment',
  handoff: 'Handoff',
} as const;

export const chatbotNodeTypeValues = Object.keys(chatbotNodeTypeLabels) as [
  keyof typeof chatbotNodeTypeLabels,
  ...(keyof typeof chatbotNodeTypeLabels)[],
];

export type ChatbotNodeType = keyof typeof chatbotNodeTypeLabels;

// Conversation status labels
export const conversationStatusLabels = {
  active: 'Active',
  bot_handling: 'Bot Handling',
  agent_handling: 'Agent Handling',
  closed: 'Closed',
  expired: 'Expired',
} as const;

export const conversationStatusValues = Object.keys(
  conversationStatusLabels
) as [
  keyof typeof conversationStatusLabels,
  ...(keyof typeof conversationStatusLabels)[],
];

export type ConversationStatus = keyof typeof conversationStatusLabels;

// Message role labels
export const messageRoleLabels = {
  bot: 'Bot',
  user: 'User',
  agent: 'Agent',
  system: 'System',
} as const;

export const messageRoleValues = Object.keys(messageRoleLabels) as [
  keyof typeof messageRoleLabels,
  ...(keyof typeof messageRoleLabels)[],
];

export type MessageRole = keyof typeof messageRoleLabels;

// Message type labels
export const messageTypeLabels = {
  text: 'Text',
  image: 'Image',
  quick_reply: 'Quick Reply',
  template: 'Template',
  attachment: 'Attachment',
} as const;

export const messageTypeValues = Object.keys(messageTypeLabels) as [
  keyof typeof messageTypeLabels,
  ...(keyof typeof messageTypeLabels)[],
];

export type MessageType = keyof typeof messageTypeLabels;

// Messaging platform labels
export const messagingPlatformLabels = {
  facebook_messenger: 'Facebook Messenger',
  instagram_dm: 'Instagram DM',
  whatsapp: 'WhatsApp',
  sms: 'SMS',
} as const;

export const messagingPlatformValues = Object.keys(messagingPlatformLabels) as [
  keyof typeof messagingPlatformLabels,
  ...(keyof typeof messagingPlatformLabels)[],
];

export type MessagingPlatform = keyof typeof messagingPlatformLabels;

// Chatbot version change type labels
export const chatbotVersionChangeTypeLabels = {
  created: 'Created',
  updated: 'Updated',
  published: 'Published',
  restored: 'Restored',
} as const;

export const chatbotVersionChangeTypeValues = Object.keys(
  chatbotVersionChangeTypeLabels
) as [
  keyof typeof chatbotVersionChangeTypeLabels,
  ...(keyof typeof chatbotVersionChangeTypeLabels)[],
];

export type ChatbotVersionChangeType =
  keyof typeof chatbotVersionChangeTypeLabels;

// Tone region labels
export const toneRegionLabels = {
  ie: 'Ireland',
  uk: 'United Kingdom',
  us: 'United States',
} as const;

export const toneRegionValues = Object.keys(toneRegionLabels) as [
  keyof typeof toneRegionLabels,
  ...(keyof typeof toneRegionLabels)[],
];

export type ToneRegion = keyof typeof toneRegionLabels;

// Conversation stage labels
export const conversationStageLabels = {
  first_contact: 'First Contact',
  qualified: 'Qualified',
  booking: 'Booking',
  follow_up: 'Follow Up',
  escalation: 'Escalation',
  enquiry: 'Enquiry',
  interest: 'Interest',
  stall: 'Stall',
} as const;

export const conversationStageValues = Object.keys(conversationStageLabels) as [
  keyof typeof conversationStageLabels,
  ...(keyof typeof conversationStageLabels)[],
];

export type ConversationStage = keyof typeof conversationStageLabels;

// Chatbot goal labels
export const chatbotGoalLabels = {
  free_consultation: 'Free Consultation',
  paid_consultation: 'Paid Consultation',
  direct_booking: 'Direct Booking',
  phone_callback: 'Phone Callback',
} as const;

export const chatbotGoalValues = Object.keys(chatbotGoalLabels) as [
  keyof typeof chatbotGoalLabels,
  ...(keyof typeof chatbotGoalLabels)[],
];

export type ChatbotGoal = keyof typeof chatbotGoalLabels;

// Chatbot tone labels
export const chatbotToneLabels = {
  friendly: 'Friendly',
  professional: 'Professional',
  luxe: 'Luxe',
} as const;

export const chatbotToneValues = Object.keys(chatbotToneLabels) as [
  keyof typeof chatbotToneLabels,
  ...(keyof typeof chatbotToneLabels)[],
];

export type ChatbotTone = keyof typeof chatbotToneLabels;
