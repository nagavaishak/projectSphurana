import { randomUUID } from 'node:crypto';
import {
  type AdAnalysis,
  CPL_THRESHOLDS,
  type CplRating,
  type Recommendation,
} from '../../../models/index.js';

/**
 * Analyzes CPL and returns the rating
 */
export function getCplRating(cpl: number | null): CplRating | null {
  if (cpl === null) return null;

  if (cpl <= CPL_THRESHOLDS.EXCELLENT) return 'excellent';
  if (cpl <= CPL_THRESHOLDS.GOOD) return 'good';
  if (cpl <= CPL_THRESHOLDS.ACCEPTABLE) return 'acceptable';
  if (cpl <= CPL_THRESHOLDS.CONCERNING) return 'concerning';
  return 'poor';
}

/**
 * Analyzes an ad's CPL and generates recommendations
 *
 * Returns recommendations based on CPL performance:
 * - Excellent (<=€5): Scale opportunity
 * - Good (<=€8): Performing well (low priority info)
 * - Acceptable (<=€15): No recommendation
 * - Concerning (<=€20): Review creative
 * - Poor (>€20): Turn off ad
 */
export function analyzeCpl(analysis: AdAnalysis): Recommendation[] {
  const recommendations: Recommendation[] = [];

  // Skip if no leads or still learning
  if (analysis.isLearning || analysis.averageCpl === null) {
    return recommendations;
  }

  const cpl = analysis.averageCpl;
  const rating = getCplRating(cpl);

  const baseRec = {
    adId: analysis.adId,
    adName: analysis.adName,
    campaignId: analysis.campaignId,
    campaignName: analysis.campaignName,
    metrics: {
      cpl: analysis.averageCpl,
      spend: analysis.totalSpend,
      leads: analysis.totalLeads,
    },
    createdAt: new Date().toISOString(),
  };

  switch (rating) {
    case 'excellent':
      recommendations.push({
        id: randomUUID(),
        type: 'scale',
        priority: 'high',
        title: 'Scale this ad',
        description: `CPL is €${cpl.toFixed(2)} — well below the €${CPL_THRESHOLDS.EXCELLENT} target. Consider increasing budget.`,
        ...baseRec,
      });
      break;

    case 'good':
      recommendations.push({
        id: randomUUID(),
        type: 'performing_well',
        priority: 'low',
        title: 'Performing well',
        description: `CPL is €${cpl.toFixed(2)}. No action needed.`,
        ...baseRec,
      });
      break;

    case 'concerning':
      recommendations.push({
        id: randomUUID(),
        type: 'high_cpl',
        priority: 'medium',
        title: 'High cost per lead',
        description: `CPL is €${cpl.toFixed(2)} — above the €${CPL_THRESHOLDS.ACCEPTABLE} target. Review your copy and targeting.`,
        ...baseRec,
      });
      break;

    case 'poor':
      recommendations.push({
        id: randomUUID(),
        type: 'turn_off',
        priority: 'critical',
        title: 'Consider pausing this ad',
        description: `CPL is €${cpl.toFixed(2)} — over €${CPL_THRESHOLDS.CONCERNING}. Spent €${analysis.totalSpend.toFixed(2)} for ${analysis.totalLeads} lead${analysis.totalLeads === 1 ? '' : 's'}.`,
        ...baseRec,
      });
      break;

    // 'acceptable' - no recommendation needed
  }

  return recommendations;
}
