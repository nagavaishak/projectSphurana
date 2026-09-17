import { useNavigate } from '@tanstack/react-router';
import { CornerDownLeftIcon, SparklesIcon } from 'lucide-react';
import type * as React from 'react';
import { useCallback, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import {
  type ClairePrefillEntityType,
  buildClairePrefillSearch,
} from '../lib/build-claire-prefill-url';

export interface AskClaireFooterProps {
  /**
   * Optional entity to pin into the active-context chip and forward as
   * `entityType` / `entityId` on the first chat turn. Both must be provided
   * together — passing one without the other renders no chip and skips the
   * active-context forward.
   */
  entityType?: ClairePrefillEntityType;
  entityId?: string;
  /** Display label for the pinned-entity chip (e.g. campaign name). */
  attachedLabel?: string;
  /** Optional icon override for the chip; defaults to a sparkles glyph. */
  attachedIcon?: React.ReactNode;
  placeholder?: string;
  className?: string;
}

/**
 * Bottom-of-page "Ask Claire" composer. Lighter-weight cousin of the full
 * chat composer in `ai-elements/prompt-input.tsx`: it doesn't stream a
 * conversation in place — submitting routes to `/assistant` with the prompt
 * prefilled and (optionally) an entity context pinned for the first turn.
 *
 * Companion to <AskClaireButton/>: use the button for one-shot triggers
 * (e.g. inside a dialog) and the footer when a feature page wants an ambient
 * "type your question" affordance.
 */
export function AskClaireFooter({
  entityType,
  entityId,
  attachedLabel,
  attachedIcon,
  placeholder = 'Ask Claire...',
  className,
}: AskClaireFooterProps) {
  const navigate = useNavigate();
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const isEmpty = trimmed.length === 0;

  const hasEntity = Boolean(entityType && entityId);
  const showChip = hasEntity && Boolean(attachedLabel);

  const submit = useCallback(() => {
    if (!trimmed) return;
    const search = buildClairePrefillSearch(trimmed, {
      entityType: hasEntity ? entityType : undefined,
      entityId: hasEntity ? entityId : undefined,
    });
    navigate({ to: '/assistant', search });
  }, [trimmed, entityType, entityId, hasEntity, navigate]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        submit();
      }
    },
    [submit]
  );

  return (
    <div
      className={cn(
        // Stick to the bottom of the nearest scroll container so the composer
        // stays in view as feature pages scroll. `mt-auto` pushes the wrapper
        // to the bottom of short pages (parent must be a flex column with
        // `flex-1`, e.g. PageShell `fillHeight`). The vertical gradient hides
        // content peeking behind the rounded card as it scrolls past.
        'sticky bottom-0 z-10 mt-auto pt-4 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
        'bg-gradient-to-t from-background via-background to-transparent',
        className
      )}
    >
      <div className="bg-card flex flex-col rounded-2xl border border-border shadow-sm">
        <div className="flex flex-col items-stretch px-4 pt-3 pb-1">
          {showChip ? (
            <div className="mb-2 flex flex-wrap gap-2">
              <span className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2.5 py-1 text-sm font-medium text-foreground">
                {attachedIcon ?? (
                  <SparklesIcon
                    className="size-3.5 shrink-0 text-emerald-600"
                    aria-hidden
                  />
                )}
                <span className="truncate">{attachedLabel}</span>
              </span>
            </div>
          ) : null}
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            aria-label={
              hasEntity && attachedLabel
                ? `Ask Claire about ${attachedLabel}`
                : 'Ask Claire'
            }
            rows={2}
            className="text-foreground placeholder:text-muted-foreground min-h-[48px] w-full resize-none bg-transparent text-base focus:outline-none"
          />
        </div>
        <div className="flex items-center justify-end px-3 pb-3 pt-1">
          <Button
            type="button"
            size="icon"
            disabled={isEmpty}
            onClick={submit}
            aria-label="Send to Claire"
            className="size-8 rounded-xl"
          >
            <CornerDownLeftIcon className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
