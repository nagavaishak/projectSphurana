import { randomUUID } from 'node:crypto';
import {
  type AdAnalysis,
  BURNOUT_THRESHOLDS,
  type DailyInsight,
  type Recommendation,
} from '../../../models/index.js';

/**
 * Checks if CPL is rising over consecutive days
 *
 * @param insights - Daily insights sorted by date (oldest first)
 * @param consecutiveDays - Number of consecutive rising days to detect
 * @returns true if CPL has risen for the specified number of consecutive days
 */
export function hasRisingCpl(
  insights: DailyInsight[],
  consecutiveDays: number = BURNOUT_THRESHOLDS.RISING_CPL_DAYS
): boolean {
  // Need at least consecutiveDays of data
  if (insights.length < consecutiveDays) {
    return false;
  }

  // Get the last N days with valid CPL
  const recentInsights = insights
    .filter((i) => i.cpl !== null && i.cpl > 0)
    .slice(-consecutiveDays);

  if (recentInsights.length < consecutiveDays) {
    return false;
  }

  // Check if each day's CPL is higher than the previous
  for (let i = 1; i < recentInsights.length; i++) {
    const current = recentInsights[i].cpl ?? 0;
    const previous = recentInsights[i - 1].cpl ?? 0;
    if (current <= previous) {
      return false;
    }
  }

  return true;
}

/**
 * Calculates CTR decline percentage
 *
 * @param insights - Daily insights sorted by date (oldest first)
 * @returns Percentage decline (0-1), or null if not enough data
 */
export function getCtrDecline(insights: DailyInsight[]): number | null {
  if (insights.length < 2) {
    return null;
  }

  // Compare first half average to second half average
  const midpoint = Math.floor(insights.length / 2);
  const firstHalf = insights.slice(0, midpoint);
  const secondHalf = insights.slice(midpoint);

  const firstAvg =
    firstHalf.reduce((sum, i) => sum + i.ctr, 0) / firstHalf.length;
  const secondAvg =
    secondHalf.reduce((sum, i) => sum + i.ctr, 0) / secondHalf.length;

  if (firstAvg === 0) {
    return null;
  }

  // Calculate decline percentage
  return (firstAvg - secondAvg) / firstAvg;
}

/**
 * Detects ad burnout and generates recommendations
 *
 * Burnout indicators:
 * - Critical: Frequency >= 3.0 + rising CPL
 * - Warning: Frequency >= 2.5 OR (CTR decline > 20% + rising CPL)
 */
export function detectBurnout(analysis: AdAnalysis): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Skip if learning or not enough data
  if (analysis.isLearning || analysis.dailyInsights.length < 4) {
    return recommendations;
  }

  const frequency = analysis.currentFrequency;
  const risingCpl = hasRisingCpl(analysis.dailyInsights);
  const ctrDecline = getCtrDecline(analysis.dailyInsights);

  const baseRec = {
    adId: analysis.adId,
    adName: analysis.adName,
    campaignId: analysis.campaignId,
    campaignName: analysis.campaignName,
    metrics: {
      frequency: analysis.currentFrequency,
      cpl: analysis.averageCpl,
      ctr:
        analysis.dailyInsights.length > 0
          ? analysis.dailyInsights[analysis.dailyInsights.length - 1].ctr
          : undefined,
    },
    createdAt: new Date().toISOString(),
  };

  // Critical burnout: High frequency + rising CPL
  if (frequency >= BURNOUT_THRESHOLDS.CRITICAL_FREQUENCY && risingCpl) {
    recommendations.push({
      id: randomUUID(),
      type: 'burnout',
      priority: 'critical',
      title: 'Ad burnout',
      description: `Frequency is ${frequency.toFixed(1)} and CPL has risen for ${BURNOUT_THRESHOLDS.RISING_CPL_DAYS}+ consecutive days. Swap in fresh creative.`,
      ...baseRec,
    });
    return recommendations;
  }

  // Warning burnout: Moderate frequency or CTR decline + rising CPL
  const hasCtrDecline =
    ctrDecline !== null &&
    ctrDecline >= BURNOUT_THRESHOLDS.CTR_DECLINE_THRESHOLD;

  if (frequency >= BURNOUT_THRESHOLDS.WARNING_FREQUENCY) {
    recommendations.push({
      id: randomUUID(),
      type: 'burnout',
      priority: 'medium',
      title: 'Ad fatigue warning',
      description: `Frequency is ${frequency.toFixed(1)}. Prepare a new creative variant.`,
      ...baseRec,
    });
    return recommendations;
  }

  if (hasCtrDecline && risingCpl) {
    recommendations.push({
      id: randomUUID(),
      type: 'burnout',
      priority: 'medium',
      title: 'Performance declining',
      description: `CTR dropped ${((ctrDecline ?? 0) * 100).toFixed(0)}% and CPL is rising.`,
      ...baseRec,
    });
  }

  return recommendations;
}
