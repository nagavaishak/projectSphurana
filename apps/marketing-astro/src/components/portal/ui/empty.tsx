import type * as React from 'react';

import { cn } from '@/lib/utils';

/**
 * Empty / error state block. Same parts as the shadcn `Empty` component
 * apps/app used (which is not present in marketing-astro's `components/ui`),
 * kept API-compatible so the pages read as a move.
 */
export function Empty({ className, children }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-12 text-center',
        className
      )}
    >
      {children}
    </div>
  );
}

export function EmptyHeader({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col items-center gap-2">{children}</div>;
}

export function EmptyMedia({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-muted text-muted-foreground mb-1 flex size-11 items-center justify-center rounded-xl [&>svg]:size-5">
      {children}
    </div>
  );
}

export function EmptyTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold">{children}</h2>;
}

export function EmptyDescription({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground max-w-sm text-sm text-balance">
      {children}
    </p>
  );
}

export function EmptyContent({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap justify-center gap-2">{children}</div>;
}
