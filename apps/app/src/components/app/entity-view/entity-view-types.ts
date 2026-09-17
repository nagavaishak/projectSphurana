import type { ReactNode } from 'react';

/**
 * The declarative shape behind every full-page entity VIEW — the read
 * counterpart to `entity-editor`.
 *
 * Deliberately content-agnostic in the same way: a feature supplies identity,
 * a tab list and a panel renderer, and gets the same header, the same tab
 * idiom, the same aside and the same spacing as every other entity. Nothing
 * here knows what an appointment or a client is.
 */

/** One tab. `id` is what appears in the URL; `label` is what a human reads. */
export interface EntityViewTab {
  id: string;
  label: string;
  /** Rendered as a small count or dot beside the label. */
  badge?: ReactNode;
}

export interface EntityViewIdentity {
  /** The name a human would say — a patient, a client. */
  title: string;
  /** One line under it: what this is and when. Never a second heading. */
  subtitle?: ReactNode;
  /** Two or three letters. */
  initials?: string;
  /** The ONE status worth a badge. More than one and the header is a dashboard. */
  status?: ReactNode;
}

export interface EntityViewConfig {
  identity: EntityViewIdentity;
  /** Where "back" goes, and what it is called. */
  back?: { label: string; onClick?: () => void };
  /** Top-right. Two buttons and an overflow, at most. */
  actions?: ReactNode;
  tabs: EntityViewTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  /**
   * The right-hand column. It does NOT change with the tab — that is the whole
   * reason it exists. Facts you need *while* reading a tab go here; facts you
   * only need sometimes belong in a tab.
   */
  aside?: ReactNode;
}
