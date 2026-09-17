export interface PlanApiLimits {
  hasApiAccess: boolean;
  maxRequestsPerHour: number;
  maxApiKeys: number;
}

export const PLAN_API_LIMITS: Record<string, PlanApiLimits> = {
  free: { hasApiAccess: false, maxRequestsPerHour: 0, maxApiKeys: 0 },
  starter: { hasApiAccess: true, maxRequestsPerHour: 500, maxApiKeys: 3 },
  pro: { hasApiAccess: true, maxRequestsPerHour: 2000, maxApiKeys: 10 },
  enterprise: {
    hasApiAccess: true,
    maxRequestsPerHour: 10000,
    maxApiKeys: 25,
  },
};

/**
 * Get API limits for a plan, defaulting to 'free' for unknown plans
 */
export function getPlanApiLimits(plan: string): PlanApiLimits {
  return PLAN_API_LIMITS[plan] ?? PLAN_API_LIMITS.free;
}
