import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Link } from '@tanstack/react-router';
import type { LucideIcon } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * The house pattern for putting a desktop `<Table>` on a phone: one card row per
 * record, primary text on the left, the value that matters on the right, and the
 * rest as a subtitle. Every mobile-ified list page uses these so they all look
 * and behave the same.
 */

export function MobileRecordList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ul
      className={cn(
        'flex flex-col divide-y divide-[#F0F0F0] overflow-hidden rounded-2xl border border-[#ECECEC] bg-white',
        className
      )}
    >
      {children}
    </ul>
  );
}

export interface MobileRecordRowProps {
  title: ReactNode;
  /** Secondary line under the title (e.g. client name, date). */
  subtitle?: ReactNode;
  /** Third line, for the details that don't fit the subtitle. */
  meta?: ReactNode;
  /** Right-hand region — amount, badge, status. */
  trailing?: ReactNode;
  /** Navigates on tap. Mutually exclusive with `onClick`. */
  to?: string;
  onClick?: () => void;
  /** Trailing chevron; defaults to on when the row is tappable. */
  showChevron?: boolean;
  testId?: string;
  className?: string;
}

export function MobileRecordRow({
  title,
  subtitle,
  meta,
  trailing,
  to,
  onClick,
  showChevron,
  testId,
  className,
}: MobileRecordRowProps) {
  const tappable = Boolean(to || onClick);
  const chevron = showChevron ?? tappable;

  const body = (
    <>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-[#0A0A0A]">
          {title}
        </span>
        {subtitle ? (
          <span className="block truncate text-[13px] text-[#737373]">
            {subtitle}
          </span>
        ) : null}
        {meta ? (
          <span className="block truncate text-[13px] text-[#A1A1A1]">
            {meta}
          </span>
        ) : null}
      </span>
      {trailing ? (
        <span className="flex shrink-0 flex-col items-end gap-1 text-right text-[15px] font-medium text-[#0A0A0A]">
          {trailing}
        </span>
      ) : null}
      {chevron ? (
        <ChevronRight className="size-4 shrink-0 text-[#C7C7CC]" aria-hidden />
      ) : null}
    </>
  );

  const rowClass = cn(
    'flex w-full items-center gap-3 px-4 py-3.5 text-left',
    tappable && 'transition active:bg-black/[0.03]',
    className
  );

  return (
    <li>
      {to ? (
        <Link to={to} id={testId} data-testid={testId} className={rowClass}>
          {body}
        </Link>
      ) : onClick ? (
        <button
          type="button"
          onClick={onClick}
          id={testId}
          data-testid={testId}
          className={rowClass}
        >
          {body}
        </button>
      ) : (
        <div id={testId} data-testid={testId} className={rowClass}>
          {body}
        </div>
      )}
    </li>
  );
}

/** Sticky-ish group label above a `MobileRecordList` (category, date, …). */
export function MobileRecordListLabel({ children }: { children: ReactNode }) {
  return (
    <p className="mb-2 mt-5 px-1 text-xs font-medium uppercase tracking-wide text-[#8E8E93] first:mt-0">
      {children}
    </p>
  );
}

export function MobileRecordListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 overflow-hidden rounded-2xl border border-[#ECECEC] bg-white p-4">
      {Array.from({ length: rows }, (_, index) => `row-${index}`).map((key) => (
        <div key={key} className="flex items-center gap-3 py-2">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-1/3" />
          </div>
          <Skeleton className="h-4 w-14" />
        </div>
      ))}
    </div>
  );
}

export function MobileRecordListEmpty({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
      <div className="flex size-14 items-center justify-center rounded-full bg-[#F2F2F7]">
        <Icon
          className="size-7 text-[#8E8E93]"
          strokeWidth={1.75}
          aria-hidden
        />
      </div>
      <div className="space-y-1">
        <p className="text-[17px] font-semibold text-[#0A0A0A]">{title}</p>
        {description ? (
          <p className="text-[15px] leading-snug text-[#737373]">
            {description}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function MobileRecordListError({ message }: { message?: string }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-6 text-center">
      <p className="text-[15px] text-destructive">
        {message ?? 'Something went wrong. Pull to refresh and try again.'}
      </p>
    </div>
  );
}

/** Page body wrapper: consistent gutters for mobile list screens. */
export function MobileListPage({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-3 px-4 py-4', className)}>
      {children}
    </div>
  );
}
