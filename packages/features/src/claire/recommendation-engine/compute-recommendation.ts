import type {
  BusinessProfile,
  OrganizationService,
  RankedService,
} from '@borradh-workspace/database';
import { recomputeRanking } from './recompute-ranking.js';

export type ComputeRecommendationResult = {
  topService: RankedService | null;
  alternatives: RankedService[];
  allRanked: RankedService[];
};

// Pure, SYNC function. The ranking (rank/score/criteriaScores/offerStrategy/
// suggestedIntroPrice/reason/objections) is recomputed LIVE from the CURRENT
// services + the profile's axes via `recomputeRanking` — it is NOT read from
// the cached `profile.rankedServices`. This means a change to the ranking code
// (or to the org's services/prices) takes effect immediately, without waiting
// for a (gated, expensive) re-classification.
//
// Copy is the only cached piece: `recomputeRanking` reuses the stored copy
// keyed by serviceId and falls back to a deterministic static copy for any
// service with no cached copy. NO LLM call happens on this path.
//
// Ranks come straight from the live ranker, so the array is already in rank
// order; callers that sort by rank still get stable output.
export const computeRecommendation = (
  profile: BusinessProfile,
  services: OrganizationService[]
): ComputeRecommendationResult => {
  const allRanked = recomputeRanking(profile, services)
    .slice()
    .sort((a, b) => a.rank - b.rank);

  const [topService = null, ...alternatives] = allRanked;
  return { topService, alternatives, allRanked };
};
