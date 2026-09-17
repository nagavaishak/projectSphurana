import { cn } from '@/lib/utils';

/**
 * Animated gradient ring around the viewport edges — shown when analysis
 * completes ("reveal" moment). Reuses the global `ai-border-rotate`
 * keyframes + `--ai-angle` @property from styles.css; the mask trick keeps
 * only the outer ring visible so content underneath stays untouched.
 */
export function ShimmerBorder({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('pointer-events-none fixed inset-0 z-50', className)}
      style={{
        padding: '4px',
        background:
          'conic-gradient(from var(--ai-angle), #6366f1, #8b5cf6, #d946ef, #ec4899, #f97316, #22c55e, #06b6d4, #3b82f6, #6366f1)',
        WebkitMask:
          'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        WebkitMaskComposite: 'xor',
        mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
        maskComposite: 'exclude',
        animation: 'ai-border-rotate 3s linear infinite',
        filter: 'blur(1px)',
      }}
    />
  );
}
