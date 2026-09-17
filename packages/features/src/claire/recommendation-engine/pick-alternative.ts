import type {
  BusinessProfile,
  OrganizationService,
  RankedService,
} from '@borradh-workspace/database';
import { computeRecommendation } from './compute-recommendation.js';

// Given a service the owner rejected, return the next-best ranked service.
// Returns null when the rejected service was the last viable option (caller
// should surface the "do_not_advertise" state or ask the owner to add new
// services).
export const pickAlternative = (
  profile: BusinessProfile,
  services: OrganizationService[],
  rejectedServiceId: string
): RankedService | null => {
  const { allRanked } = computeRecommendation(profile, services);
  const idx = allRanked.findIndex((r) => r.serviceId === rejectedServiceId);
  // If the rejected service isn't even in the ranked list, fall back to the
  // top — the owner is rejecting something the engine never recommended.
  if (idx === -1) return allRanked[0] ?? null;
  return allRanked[idx + 1] ?? null;
};
