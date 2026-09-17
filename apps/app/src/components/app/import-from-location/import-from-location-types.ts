import type { ReactNode } from 'react';

/** One record at the SOURCE branch, offered for copying. */
export interface ImportFromLocationRow {
  id: string;
  /** What the row is called — the only field the shell renders prominently. */
  name: string;
  /** Secondary detail rendered after a middot: "60 min", "200ml". */
  meta?: string;
  /** Right-aligned value: a price, a plan term. Replaced by "Already here". */
  trailing?: ReactNode;
  /**
   * This record already exists at the target branch. Rendered greyed and
   * unselectable so a second copy of the same thing cannot land.
   */
  alreadyHere?: boolean;
}

export interface ImportSourceLocation {
  id: string;
  name: string;
}

export interface ImportFromLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "Import services" */
  title: string;
  /** Lowercase plural used in counts and empty copy: "services", "products". */
  entityPlural: string;
  /** The branch the copies land in — the ACTIVE one, never the source. */
  targetLocationName: string;
  /**
   * Overrides the header line under the title.
   *
   * The default describes COPYING, which is right for catalogue records and
   * wrong for people: a practitioner imported into a branch is the same person
   * with one more place of work, not a duplicate. A caller whose import means
   * something other than "a copy lands here" must say so.
   */
  description?: string;
  /** Overrides the confirm button's verb ("Import 2" → "Add 2"). */
  confirmVerb?: string;
  /** Every OTHER branch in the org. */
  sourceLocations: ImportSourceLocation[];
  sourceLocationId: string | null;
  onSourceLocationChange: (locationId: string) => void;
  /** Rows at `sourceLocationId`. The caller fetches; the shell only renders. */
  rows: ImportFromLocationRow[];
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
  onRetry?: () => void;
  isImporting?: boolean;
  onImport: (ids: string[]) => void | Promise<void>;
}
