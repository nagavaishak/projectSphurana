import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

export function ChatSkeleton() {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-4 p-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={cn(
              'flex',
              i % 2 === 0 ? 'justify-end' : 'justify-start'
            )}
          >
            <div className="max-w-[70%] space-y-1.5">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
