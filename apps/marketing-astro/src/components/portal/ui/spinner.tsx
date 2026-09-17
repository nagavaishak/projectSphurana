import { Loader2Icon } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Indeterminate spinner. Decorative — callers own the `aria-live` region. */
export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2Icon
      role="presentation"
      aria-hidden
      className={cn('size-4 animate-spin', className)}
    />
  );
}
