import type { Campaign } from '../api/types';

/**
 * Check if a campaign has a budget set.
 * Budget values come from Meta as strings in cents (e.g., "5000" = $50).
 */
export function campaignHasBudget(campaign: Campaign): boolean {
  const dailyBudget = campaign.dailyBudget ? Number(campaign.dailyBudget) : 0;
  const lifetimeBudget = campaign.lifetimeBudget
    ? Number(campaign.lifetimeBudget)
    : 0;
  return dailyBudget > 0 || lifetimeBudget > 0;
}
