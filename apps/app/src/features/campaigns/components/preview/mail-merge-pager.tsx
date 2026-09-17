'use client';

import { Button } from '@/components/ui/button';
import { ChevronLeftIcon, ChevronRightIcon, UsersIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SampleRecipient } from '../../api/types';

export interface MailMergePagerProps {
  /** The eligible recipients to page through; empty ⇒ generic sample preview. */
  recipients: SampleRecipient[];
  /** The current recipient index (0-based). */
  index: number;
  /** Called with the new index when the user pages. */
  onIndex: (index: number) => void;
  /** The per-channel previews for the current recipient. */
  children: ReactNode;
}

/**
 * A ← / → mail-merge pager with an "N of M" label that steps through the sample
 * recipients so the composer preview shows each one's personalized version.
 * Arrows disable at the ends. When there are no recipients it shows a "Sample
 * preview" label instead of a pager and renders the generic-sample children.
 */
export function MailMergePager({
  recipients,
  index,
  onIndex,
  children,
}: MailMergePagerProps) {
  const total = recipients.length;
  const isEmpty = total === 0;
  const current = Math.min(Math.max(index, 0), Math.max(total - 1, 0));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <UsersIcon className="size-3.5" />
          {isEmpty ? (
            <span>Sample preview</span>
          ) : (
            <span>
              Recipient {current + 1} of {total}
            </span>
          )}
        </div>
        {!isEmpty && (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-7"
              aria-label="Previous recipient"
              disabled={current <= 0}
              onClick={() => onIndex(current - 1)}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-7"
              aria-label="Next recipient"
              disabled={current >= total - 1}
              onClick={() => onIndex(current + 1)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        )}
      </div>
      {children}
    </div>
  );
}
