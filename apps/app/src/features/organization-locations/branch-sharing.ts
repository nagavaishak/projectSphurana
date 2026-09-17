/**
 * Is this record reachable from more than one branch?
 *
 * The question every delete on a branch-scoped page has to ask before it
 * offers "delete everywhere", because the answer decides whether the operator
 * is about to affect the branch they are standing on or the whole business.
 *
 * EMPTY MEANS EVERY BRANCH — the empty-junction convention. So an unassigned
 * record is shared as soon as the org has a second branch, which is exactly the
 * case a naive `locationIds.length > 1` check misses: today every org's join
 * tables are empty, so that check would answer "not shared" for every record in
 * production and the prompt would never appear.
 */
export function isSharedAcrossBranches({
  locationIds,
  totalBranches,
}: {
  /** The record's branch links. Empty means every branch. */
  locationIds: string[] | undefined;
  /** How many branches the organisation has. */
  totalBranches: number;
}): boolean {
  if (totalBranches < 2) return false;
  if (!locationIds || locationIds.length === 0) return true;
  return locationIds.length > 1;
}
