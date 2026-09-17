import { FacebookIcon, InstagramIcon } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import type { MetaAdsPage } from '@/features/integrations';
import { cn } from '@/lib/utils';

interface PagePillsProps {
  pages: MetaAdsPage[];
  isLoading: boolean;
  value: string | 'all';
  onChange: (next: string | 'all') => void;
}

export function PagePills({
  pages,
  isLoading,
  value,
  onChange,
}: PagePillsProps) {
  // With a single connected page, "All" is redundant — show only that page,
  // visually selected.
  const singlePageMode = !isLoading && pages.length === 1;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {!singlePageMode && (
        <Pill isActive={value === 'all'} onClick={() => onChange('all')}>
          All
        </Pill>
      )}
      {isLoading && pages.length === 0 ? (
        <>
          <Skeleton className="h-7 w-24 rounded-full" />
          <Skeleton className="h-7 w-24 rounded-full" />
        </>
      ) : (
        pages.map((page) => {
          const Icon =
            page.platform === 'facebook' ? FacebookIcon : InstagramIcon;
          const label = page.pageName ?? page.platform;
          // In single-page mode, render as visually active regardless of internal state.
          const active = singlePageMode || value === page.id;
          return (
            <Pill
              key={page.id}
              isActive={active}
              onClick={() => onChange(page.id)}
            >
              <Icon
                className={cn(
                  'size-3.5',
                  active
                    ? 'text-current'
                    : page.platform === 'facebook'
                      ? 'text-blue-600'
                      : 'text-pink-600'
                )}
              />
              <span className="truncate max-w-[140px]">{label}</span>
            </Pill>
          );
        })
      )}
    </div>
  );
}

function Pill({
  isActive,
  onClick,
  children,
}: {
  isActive: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-3.5 py-1.5 text-xs transition-colors',
        isActive
          ? 'border-slate-800 bg-slate-800 text-white'
          : 'border-slate-800 bg-transparent text-slate-800'
      )}
    >
      {children}
    </button>
  );
}
