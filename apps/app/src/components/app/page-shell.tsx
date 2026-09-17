import { CoordinatedLoadingProvider } from '@/hooks/use-coordinated-loading';
import { cn } from '@/lib/utils';

interface PageShellProps {
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  /** Center the content (for wizard/onboarding pages) */
  centered?: boolean;
  /** Constrain content width, e.g. 'max-w-2xl' */
  maxWidth?: string;
  /**
   * Stretch the content wrapper to fill the available height, so children
   * can pin themselves to the bottom (e.g. `mt-auto`).
   */
  fillHeight?: boolean;
}

export function PageShell({
  children,
  action,
  className,
  centered,
  maxWidth,
  fillHeight,
}: PageShellProps) {
  return (
    <CoordinatedLoadingProvider>
      <main
        className={cn(
          'flex flex-1 flex-col gap-6 px-4 py-6 lg:px-6',
          centered && 'items-center',
          className
        )}
      >
        <div
          className={cn(
            'flex w-full flex-col gap-6',
            fillHeight && 'flex-1',
            maxWidth && 'mx-auto',
            maxWidth
          )}
        >
          {action && <div className="flex justify-end">{action}</div>}
          {children}
        </div>
      </main>
    </CoordinatedLoadingProvider>
  );
}
