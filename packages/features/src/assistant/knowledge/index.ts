export { generateEmbedding, generateEmbeddings } from './embed.js';
export {
  queryKnowledge,
  formatKnowledgeContext,
  type KnowledgeSearchResult,
} from './query.js';
export {
  upsertKnowledgeEntry,
  populateOrgProfile,
  populateServices,
  populateAdInsights,
  populatePostInsights,
  populateVideoPreferences,
  populateCustomerPatterns,
  populateAll,
  addKnowledgeEntry,
  KNOWLEDGE_REFRESH_SCHEDULE,
} from './populate.js';
export {
  aggregateAdInsights,
  aggregatePostInsights,
  aggregateTargetingInsights,
  runAllAggregations,
} from './aggregate.js';
export { getKnowledgeForChatbot } from './chatbot-query.js';
export {
  KNOWLEDGE_UPDATE_QUEUE,
  type KnowledgeUpdateType,
  type KnowledgeUpdateJobPayload,
  queueKnowledgeUpdate,
  processKnowledgeUpdateJob,
  closeKnowledgeUpdateQueue,
  getKnowledgeUpdateQueue,
} from './queue-knowledge-update.js';
export {
  extractFAQs,
  extractChatbotInsights,
  extractAdChatbotPatterns,
} from './extract-chatbot.js';
