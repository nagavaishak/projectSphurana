import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface StateLoadingProps {
  /** 'spinner' for inline/page loading, 'skeleton' for content placeholders */
  variant?: 'spinner' | 'skeleton';
  /** Number of skeleton items to show */
  count?: number;
  /** Custom skeleton height, e.g. 'h-48' */
  skeletonHeight?: string;
  /** Grid columns for skeleton, e.g. 'sm:grid-cols-2 lg:grid-cols-3' */
  skeletonCols?: string;
  className?: string;
}

export function StateLoading({
  variant = 'spinner',
  count = 3,
  skeletonHeight = 'h-48',
  skeletonCols = 'sm:grid-cols-2 lg:grid-cols-3',
  className,
}: StateLoadingProps) {
  if (variant === 'skeleton') {
    return (
      <div className={cn('grid gap-4', skeletonCols, className)}>
        {Array.from({ length: count }).map((_, i) => (
          <Skeleton key={i} className={cn('w-full', skeletonHeight)} />
        ))}
      </div>
    );
  }

  return (
    <div className={cn('flex items-center justify-center py-12', className)}>
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
    </div>
  );
}
