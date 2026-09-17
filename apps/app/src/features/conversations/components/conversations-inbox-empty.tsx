import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import { MessageSquare } from 'lucide-react';

import type { HandledByFilterValue } from './handled-by-filter-dropdown';

export function hasActiveInboxFilters({
  search,
  platformFilter,
  handledByFilter,
  statusFilter = 'all',
}: {
  search: string;
  platformFilter: string;
  handledByFilter: HandledByFilterValue;
  statusFilter?: string;
}): boolean {
  return (
    Boolean(search.trim()) ||
    platformFilter !== 'all' ||
    handledByFilter !== 'all' ||
    statusFilter !== 'all'
  );
}

interface ConversationsInboxEmptyProps {
  variant: 'sidebar' | 'mobile';
  hasActiveFilters: boolean;
  onClearFilters?: () => void;
}

export function ConversationsInboxEmpty({
  variant,
  hasActiveFilters,
  onClearFilters,
}: ConversationsInboxEmptyProps) {
  const title = hasActiveFilters ? 'No matches found' : 'No messages yet';
  const description = hasActiveFilters
    ? 'Try adjusting your search or filters to find client conversations.'
    : 'When clients message you on Instagram, WhatsApp, or Messenger, they’ll appear here.';

  if (variant === 'mobile') {
    return (
      <div
        className="flex min-h-[min(280px,45vh)] flex-col items-center justify-center px-8 py-14 text-center"
        role="status"
      >
        <div
          className="mb-4 flex size-14 items-center justify-center rounded-full bg-[#F2F2F7]"
          aria-hidden
        >
          <MessageSquare className="size-6 text-[#8E8E93]" strokeWidth={1.75} />
        </div>
        <h3 className="text-[17px] font-semibold tracking-tight text-[#0A0A0A]">
          {title}
        </h3>
        <p className="mt-1.5 max-w-[260px] text-[14px] leading-snug text-[#8E8E93]">
          {description}
        </p>
        {hasActiveFilters && onClearFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className={cn(
              'mt-5 rounded-full border border-[#E5E5EA] bg-white px-4 py-2.5',
              'text-[14px] font-medium leading-none text-[#0A0A0A]',
              'shadow-[0_1px_2px_rgba(0,0,0,0.05)] active:bg-[#F2F2F7]'
            )}
          >
            Clear filters
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Empty className="border-0 p-0 md:px-0">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MessageSquare />
          </EmptyMedia>
          <EmptyTitle>{title}</EmptyTitle>
          <EmptyDescription>{description}</EmptyDescription>
        </EmptyHeader>
        {hasActiveFilters && onClearFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-4 text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </Empty>
    </div>
  );
}
