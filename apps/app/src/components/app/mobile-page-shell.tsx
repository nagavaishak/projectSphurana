'use client';

import type * as React from 'react';
import type { ReactNode } from 'react';

import {
  type MobileDashboardHeaderContent,
  useMobileDashboardHeaderContent,
} from '@/features/mobile-dashboard-header';
import { cn } from '@/lib/utils';

/**
 * THE MOBILE PAGE SHELL — the phone's counterpart to `DashboardPage`.
 *
 * A phone screen is not a narrow desktop screen, and it stopped being treated
 * as one here. Every mobile page is the same five regions in the same order,
 * and this component owns all of them:
 *
 * ```
 *   ← (floating bar — back control, nothing else)
 *   Title                      [action]   ← shrink-0, stays put
 *   toolbar (search, chips, tabs)         ← shrink-0, stays put
 *   ┌──────────────────────────────────┐
 *   │ children — THE ONLY SCROLL REGION │
 *   └──────────────────────────────────┘
 *   footer (Save Changes)                 ← shrink-0, pinned
 * ```
 *
 * ## Why the title is here and not in the floating bar
 *
 * It used to be in the bar, centred, at 15px — iOS navigation chrome. That
 * shrinks the name of the screen to the smallest type on it at the exact moment
 * the user has arrived and is working out where they are, and it forces the bar
 * to compete with the page for the top of the display. The title is content. It
 * belongs in the page, left-aligned, at 32px, which is what the design asks for
 * (Figma: Create Product / Create Promotion) and what the desktop already did.
 *
 * The bar keeps ONE job: the way back. No branch chip on a drill-down, no
 * inbox, no bell, no avatar — those were root-screen chrome shown on screens
 * that are not roots.
 *
 * ## Why the shell owns the scrolling
 *
 * Title, toolbar and footer are `shrink-0`; the content is `min-h-0 flex-1
 * overflow-y-auto`. That is what keeps a search field and a Save bar in place
 * while a long list moves underneath them, and it is the detail every
 * hand-rolled mobile page in here got subtly differently — some scrolled the
 * whole page, some scrolled the toolbar away, one pinned a footer that a long
 * list then hid behind.
 *
 * `DashboardPage` renders this on a phone, so a page built on the shared shell
 * gets it without asking. Pages with a genuinely bespoke phone layout use it
 * directly. Nothing should be hand-rolling this frame — see
 * `mobile-page-shell-coverage.test.ts`, which is the gate that says so.
 */
export interface MobilePageShellProps {
  title: string;
  /** One line under the title. */
  description?: ReactNode;
  /**
   * A bottom-tab screen (Claire, Inbox, Bookings, More). No back control — the
   * tab bar already says where you are — and the branch chip keeps its corner.
   */
  tabRoot?: boolean;
  /** Where the back control goes. Defaults to history, then branch home. */
  onBack?: () => void;
  /** Beside the title: one small control, e.g. the round create button. */
  action?: ReactNode;
  /** Under the title, above the scroll region: search, filter chips, tabs. */
  toolbar?: ReactNode;
  /** Pinned to the bottom edge above the tab bar: Save / Continue. */
  footer?: ReactNode;
  children: ReactNode;
  /** Extra header config for the rare page that needs it (a custom action). */
  header?: Partial<MobileDashboardHeaderContent>;
  className?: string;
  /** On the scroll region — e.g. `px-4` for a page whose rows are inset. */
  contentClassName?: string;
}

type MobilePageShellAllProps = MobilePageShellProps &
  React.HTMLAttributes<HTMLDivElement>;

export function MobilePageShell({
  title,
  description,
  tabRoot = false,
  onBack,
  action,
  toolbar,
  footer,
  children,
  header,
  className,
  contentClassName,
  ...rest
}: MobilePageShellAllProps) {
  // `hideTrailing` is NOT set: the trailing edge carries the branch switcher.
  //
  // It was set here to suppress the old inbox/bell/avatar trio, which no longer
  // exists — and leaving it on would have hidden the switcher from every page
  // built on this shell, which is nearly all of them. The full-screen wizards
  // still pass it, deliberately: switching branch half-way through creating
  // something is not a control that flow should offer.
  useMobileDashboardHeaderContent(
    tabRoot ? { ...header } : { showBack: true, onBack, ...header }
  );

  return (
    <div
      className={cn('flex min-h-0 flex-1 flex-col overflow-hidden', className)}
      {...rest}
    >
      <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-2 pb-3">
        <div className="min-w-0">
          <h1 className="font-bold text-[32px] leading-tight tracking-[-0.02em]">
            {title}
          </h1>
          {description && (
            <p className="mt-1 text-[13px] text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {toolbar && <div className="shrink-0 px-4 pb-3">{toolbar}</div>}

      <div
        className={cn(
          'min-h-0 flex-1 overflow-y-auto [-webkit-overflow-scrolling:touch]',
          contentClassName
        )}
        data-list-scroll=""
        data-mobile-scroll=""
      >
        {children}
      </div>

      {footer && (
        <div className="shrink-0 border-t bg-background px-4 py-3">
          {footer}
        </div>
      )}
    </div>
  );
}
