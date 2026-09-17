import { randomUUID } from 'node:crypto';
import {
  type AdAnalysis,
  LEARNING_PHASE_THRESHOLD,
  type Recommendation,
} from '../../../models/index.js';

/**
 * Checks if an ad is in the learning phase
 *
 * An ad is considered "learning" if total spend < €75
 */
export function isInLearningPhase(totalSpend: number): boolean {
  return totalSpend < LEARNING_PHASE_THRESHOLD;
}

/**
 * Analyzes an ad for learning phase status and generates recommendation
 *
 * Returns a recommendation to let the ad run if it's still learning
 */
export function analyzeLearningPhase(analysis: AdAnalysis): Recommendation[] {
  const recommendations: Recommendation[] = [];

  if (!analysis.isLearning) {
    return recommendations;
  }

  const progress = Math.round(
    (analysis.totalSpend / LEARNING_PHASE_THRESHOLD) * 100
  );

  recommendations.push({
    id: randomUUID(),
    type: 'learning',
    priority: 'low',
    title: 'Still learning',
    description: `€${analysis.totalSpend.toFixed(2)} of €${LEARNING_PHASE_THRESHOLD} spent (${progress}%). Avoid changes until learning completes.`,
    adId: analysis.adId,
    adName: analysis.adName,
    campaignId: analysis.campaignId,
    campaignName: analysis.campaignName,
    metrics: {
      spend: analysis.totalSpend,
      leads: analysis.totalLeads,
    },
    createdAt: new Date().toISOString(),
  });

  return recommendations;
}
