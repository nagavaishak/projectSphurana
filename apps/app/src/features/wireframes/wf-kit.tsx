'use client';

/**
 * Layout helpers shared by the clinic-side wireframes.
 *
 * These pages exist so NEW surfaces can be reviewed in the real UI kit before
 * any of them get a backend:
 *
 *  - every page is STATIC — fixtures only, no queries, no mutations
 *  - nothing in the product links here
 *  - a page is deleted once its surface ships for real
 *
 * Real pages use `DashboardPage` (lists use `ListPage`, editors use
 * `entity-editor`). Wireframes use the same components, wrapped by `WfFrame`,
 * which keeps every piece of review scaffolding OUT of the canvas.
 *
 * What survives in this file are helpers that are genuinely part of a screen: a
 * titled section, and a placeholder where a real chart would go. The note
 * banner, metric tile and inline progress bar were deleted once the pages were
 * edited down — they had no call sites left, and leaving a "this is a
 * wireframe" banner component loaded is an invitation to put one back on a
 * canvas that is supposed to hold only the product.
 */

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** A labelled section with a heading, used across the non-list wireframes. */
export function WfSection({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-semibold text-lg">{title}</h2>
          {description ? (
            <p className="text-muted-foreground text-sm">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * A placeholder where a chart would go. Says what it would be rather than
 * drawing invented data, because fake numbers invite feedback on the numbers
 * instead of on the screen.
 */
export function WfChart({
  kind,
  height = 'h-56',
}: {
  kind: string;
  height?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-xl border border-dashed bg-muted/30 text-center',
        height
      )}
    >
      <p className="px-6 text-muted-foreground text-sm">{kind}</p>
    </div>
  );
}
