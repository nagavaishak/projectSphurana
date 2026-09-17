export interface PlanAssistantLimits {
  hasAssistantAccess: boolean;
  maxMessagesPerDay: number;
  maxMessagesPerMonth: number;
  maxKnowledgeEntries: number;
  maxConversations: number; // -1 = unlimited
}

export const PLAN_ASSISTANT_LIMITS: Record<string, PlanAssistantLimits> = {
  free: {
    hasAssistantAccess: false,
    maxMessagesPerDay: 0,
    maxMessagesPerMonth: 0,
    maxKnowledgeEntries: 0,
    maxConversations: 0,
  },
  starter: {
    hasAssistantAccess: true,
    maxMessagesPerDay: 25,
    maxMessagesPerMonth: 500,
    maxKnowledgeEntries: 100,
    maxConversations: 50,
  },
  pro: {
    hasAssistantAccess: true,
    maxMessagesPerDay: 100,
    maxMessagesPerMonth: 2000,
    maxKnowledgeEntries: 500,
    maxConversations: -1,
  },
  enterprise: {
    hasAssistantAccess: true,
    maxMessagesPerDay: 500,
    maxMessagesPerMonth: 10000,
    maxKnowledgeEntries: 2000,
    maxConversations: -1,
  },
};

/**
 * Get assistant limits for a plan, defaulting to 'free' for unknown plans
 */
export function getPlanAssistantLimits(plan: string): PlanAssistantLimits {
  return PLAN_ASSISTANT_LIMITS[plan] ?? PLAN_ASSISTANT_LIMITS.free;
}
