import { cn } from '@/lib/utils';

interface ShimmerCardProps {
  label?: string;
  className?: string;
}

/**
 * "Generating…" placeholder card with an animated shimmer sweep. Used while
 * ad/video candidates render. Reuses the global `ai-shimmer` keyframes.
 */
export function ShimmerCard({
  label = 'Generating…',
  className,
}: ShimmerCardProps) {
  return (
    <div
      className={cn(
        'border-input relative flex min-h-32 items-center justify-center overflow-hidden rounded-lg border',
        className
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, var(--muted) 25%, var(--accent) 50%, var(--muted) 75%)',
          backgroundSize: '200% 100%',
          animation: 'ai-shimmer 1.5s ease-in-out infinite',
        }}
      />
      <span className="text-muted-foreground relative text-sm">{label}</span>
    </div>
  );
}
