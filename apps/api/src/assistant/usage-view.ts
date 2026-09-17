import { db } from '@borradh-workspace/database';
import {
  getAssistantUsage,
  getAssistantUsageHistory,
  getPlanAssistantLimits,
} from '@borradh-workspace/features/assistant';
import { getSubscription } from '@borradh-workspace/features/billing';
import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * `GET /assistant/usage` and `GET /assistant/usage/history` response
 * projections.
 *
 * Both routes do the same three-step join — resolve the org's plan, turn the
 * plan into limits, fetch the counters — and then shape the two into a view.
 * That is a read model, not transport, and it was the reason both handlers ran
 * 33–37 lines.
 *
 * The plan fallback matters and is preserved: a FAILED subscription lookup
 * yields `'free'`, not an error. An org between plans, or one whose billing row
 * is missing, still gets a usable usage panel instead of a 500.
 */

interface ErrorShape {
  code: string;
  message: string;
}

async function planAndLimits(organizationId: string) {
  const subResult = await getSubscription(db, { organizationId });
  const planId = subResult.success ? subResult.data.planId : 'free';
  return { planId, limits: getPlanAssistantLimits(planId) };
}

/** Current daily/monthly consumption against the plan's ceilings. */
export async function buildAssistantUsageView(organizationId: string) {
  const { planId, limits } = await planAndLimits(organizationId);

  const usageResult = await getAssistantUsage(db, { organizationId });
  if (!usageResult.success) {
    throw new HttpException(
      usageResult.error.message,
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }

  const { daily, monthly } = usageResult.data;

  return {
    planId,
    daily: {
      used: daily,
      limit: limits.maxMessagesPerDay,
      remaining: Math.max(0, limits.maxMessagesPerDay - daily),
    },
    monthly: {
      used: monthly,
      limit: limits.maxMessagesPerMonth,
      remaining: Math.max(0, limits.maxMessagesPerMonth - monthly),
    },
    hasAccess: limits.hasAssistantAccess,
  };
}

/** Time series + top tools, with the plan's ceilings alongside. */
export async function buildAssistantUsageHistoryView(
  organizationId: string,
  window: { days?: number; monthlyMonths?: number },
  mapError: (error: ErrorShape) => HttpException
) {
  const { planId, limits } = await planAndLimits(organizationId);

  const result = await getAssistantUsageHistory(db, {
    organizationId,
    days: window.days,
    monthlyMonths: window.monthlyMonths,
  });
  if (!result.success) {
    throw mapError(result.error);
  }

  return {
    planId,
    dailyLimit: limits.maxMessagesPerDay,
    monthlyLimit: limits.maxMessagesPerMonth,
    daily: result.data.daily,
    monthly: result.data.monthly,
    topTools: result.data.topTools,
  };
}
