export interface LabSample {
  id: string;
  name: string;
  kind: string;
  video: string | null;
  image: string | null;
  w: number | null;
  h: number | null;
}

/**
 * Committed EMPTY on purpose — these are real customers' ad creatives.
 * Repopulate locally with:
 *   scripts/prod-run.sh pnpm exec tsx scripts/sample-ad-creatives.ts
 */
export const labSamples: LabSample[] = [];
