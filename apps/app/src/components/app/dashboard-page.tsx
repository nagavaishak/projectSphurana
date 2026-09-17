'use client';

import type * as React from 'react';
import type { ReactNode } from 'react';

import type { MobileDashboardHeaderContent } from '@/features/mobile-dashboard-header';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

import { MobilePageShell } from './mobile-page-shell';

/**
 * The top-level framing for a dashboard page.
 *
 * One title, one rhythm, one content width — for LIST pages and non-list pages
 * alike. `ListPage` renders its table inside this; the Services grid, the AI
 * Assistant chat and the Booking page editor render their own content inside the
 * same shell, so a page does not look like a different product depending on
 * whether it happens to contain a table.
 *
 * Metrics are the ones already agreed for lists: 24px semibold title, a 16px
 * gap between every stacked element, and a 1079px centred column matching the
 * editor's content width (Figma node 3105:8141).
 *
 * NOT to be confused with `components/app/page-shell.tsx`, which is padding
 * only and carries no header. This replaces the hand-written
 * `<div><h1>…</h1><p>…</p></div>` block that every page grew its own copy of.
 *
 * ## The phone is a different shell, not a narrower one
 *
 * On a phone this renders `MobilePageShell` — a different component, not this
 * one with smaller type. Read that file for the shape and the reasoning; the
 * short version is that a phone screen is a back control, a 32px left-aligned
 * title, a fixed toolbar, one scroll region and an optional pinned footer, and
 * squeezing the desktop's header row into 375px produced none of that.
 *
 * The branch is a real render branch (`useIsMobile`), not `max-md:` classes,
 * because the two shells have different DOM: the phone's content scrolls inside
 * the shell while the desktop page scrolls as a whole, and no amount of
 * responsive class-swapping turns one into the other.
 */
export function DashboardPage({
  title,
  description,
  actions,
  toolbar,
  children,
  /**
   * Fill the viewport and let CHILDREN own scrolling — for the chat surface,
   * whose composer must stay pinned while the transcript scrolls. Ordinary
   * pages scroll as a whole and should leave this off.
   */
  fillHeight = false,
  mobileHeader,
  className,
  contentClassName,
  ...rest
}: {
  title: string;
  description?: ReactNode;
  /** Top-right of the header row: the page's primary action(s). */
  actions?: ReactNode;
  /** Row beneath the header: search, filters, tabs. */
  toolbar?: ReactNode;
  children: ReactNode;
  fillHeight?: boolean;
  /**
   * Override the phone header this page publishes — or `false` to publish
   * nothing and leave the root-screen chrome (branch chip, inbox, bell,
   * avatar) in place.
   *
   * The default is the drill-down chrome, because every page built on this
   * shell today is reached FROM somewhere. A page that becomes a bottom-tab
   * root must say so here; the shell cannot tell from the props alone.
   *
   * ReactNode fields (`extraActions`, `rightSlot`, …) must be memoized by the
   * caller — `useMobileDashboardHeaderContent` compares them by reference.
   */
  mobileHeader?: Partial<MobileDashboardHeaderContent> | false;
  className?: string;
  contentClassName?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <MobilePageShell
        action={actions}
        contentClassName={contentClassName}
        description={description}
        header={mobileHeader === false ? undefined : mobileHeader}
        tabRoot={mobileHeader === false}
        title={title}
        toolbar={toolbar}
        {...rest}
      >
        {children}
      </MobilePageShell>
    );
  }

  return (
    <div
      className={cn(
        'mx-auto flex w-full max-w-[1079px] flex-col gap-4 px-4 py-6 md:px-6',
        fillHeight && 'min-h-0 flex-1',
        className
      )}
      {...rest}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-semibold text-2xl">{title}</h1>
          {description && (
            <p className="mt-1 text-muted-foreground text-sm">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
      </div>

      {toolbar}

      {/*
        `min-h-0` matters when fillHeight is set: without it a flex child
        refuses to shrink below its content, and the chat transcript grows the
        page instead of scrolling inside it.
      */}
      <div
        className={cn(
          fillHeight && 'flex min-h-0 flex-1 flex-col',
          contentClassName
        )}
      >
        {children}
      </div>
    </div>
  );
}
