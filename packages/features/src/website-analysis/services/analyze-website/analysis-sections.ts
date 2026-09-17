/**
 * The one vocabulary of "things a scan can be about", shared by all three
 * stages: what the prompt ASKS for, what the plan DIFFS, and what the apply
 * WRITES. One list means a section cannot be scannable but un-appliable.
 *
 * Deliberately a dependency-free leaf module. The settings scan UI renders one
 * checkbox per section, so these strings have to reach the browser bundle;
 * keeping them out of `analyze-website.schema.ts` means a frontend consumer
 * can reach them without pulling in the scraping strategies behind the
 * website-analysis barrel.
 */
export const analysisSectionValues = [
  'brand',
  'description',
  'services',
  'packages',
  'location',
  'hours',
  'team',
] as const;

export type AnalysisSection = (typeof analysisSectionValues)[number];
