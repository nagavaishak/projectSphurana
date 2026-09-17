import type { ReactNode } from 'react';

export interface MobileDashboardHeaderAction {
  id: string;
  ariaLabel: string;
  icon: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  /** Renders a small red indicator on the control (e.g. unread). */
  showBadge?: boolean;
}

export interface MobileDashboardHeaderContent {
  heading?: string;
  subheading?: string;
  /** Shows the shared back control on the leading edge. */
  showBack?: boolean;
  /** Custom back handler; falls back to browser history (or dashboard home). */
  onBack?: () => void;
  /** Center-align heading and subheading (e.g. conversation detail title). */
  centerTitle?: boolean;
  /**
   * Use the smaller centered title style (15px semibold) even without a subheading.
   * Matches the heading size used when `subheading` is set.
   */
  compactTitle?: boolean;
  /** Custom center region — replaces the default heading/subheading block. */
  centerSlot?: ReactNode;
  /**
   * Custom leading region (e.g. the bookings burger) — replaces the back
   * control on the leading edge.
   */
  leadingSlot?: ReactNode;
  /**
   * Custom leading-aligned title region — replaces the heading/subheading block
   * while keeping the default (non-centered) grid.
   */
  titleSlot?: ReactNode;
  /** Align grid columns to the top (e.g. tall center content with back on the leading edge). */
  alignItemsTop?: boolean;
  /** Hides the default notifications bell (still shown when using custom right actions). */
  hideNotifications?: boolean;
  /** Hides the default inbox shortcut (e.g. on the inbox itself). */
  hideInbox?: boolean;
  /** Hides all trailing controls (notifications, user menu, `rightActions`, `rightSlot`). */
  hideTrailing?: boolean;
  /**
   * Page-specific controls (e.g. "Add client") rendered BEFORE the default
   * inbox/bell/avatar trio — unlike `rightSlot`, which replaces them.
   */
  extraActions?: ReactNode;
  /** Replaces default notifications + user menu when set. */
  rightActions?: MobileDashboardHeaderAction[];
  /** Fully custom trailing region — replaces default actions and `rightActions`. */
  rightSlot?: ReactNode;
}
