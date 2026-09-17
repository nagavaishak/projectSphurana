export interface PlanPhoneNumberLimits {
  maxPhoneNumbers: number;
  canBuyNumbers: boolean;
  includedNumbers: number;
}

export const PLAN_PHONE_NUMBER_LIMITS: Record<string, PlanPhoneNumberLimits> = {
  free: { maxPhoneNumbers: 0, canBuyNumbers: false, includedNumbers: 0 },
  starter: { maxPhoneNumbers: 1, canBuyNumbers: true, includedNumbers: 1 },
  pro: { maxPhoneNumbers: 5, canBuyNumbers: true, includedNumbers: 2 },
  enterprise: {
    maxPhoneNumbers: 25,
    canBuyNumbers: true,
    includedNumbers: 5,
  },
};

/**
 * Get phone number limits for a plan, defaulting to 'free' for unknown plans
 */
export function getPlanPhoneNumberLimits(plan: string): PlanPhoneNumberLimits {
  return PLAN_PHONE_NUMBER_LIMITS[plan] ?? PLAN_PHONE_NUMBER_LIMITS.free;
}
