import { MessageCircle, X } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface AdvisorActionShape {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'secondary' | 'ghost' | 'outline';
  disabled?: boolean;
}

export interface AdvisorContent {
  title: string;
  body?: string;
  actions?: AdvisorActionShape[];
  footer?: ReactNode;
  /** Tag used for E2E targeting (`data-claire-advisor-active`). Defaults to undefined. */
  activeMarker?: string;
}

interface AdvisorCardShellProps {
  target: Element;
  content: AdvisorContent;
  canExit?: boolean;
  onDismiss?: () => void;
  /** Show the "Got it" advance button (used by tour mode). */
  showAdvanceButton?: boolean;
  onAdvance?: () => void;
}

interface Position {
  top: number;
  left: number;
  placedAbove: boolean;
}

const CHATBOX_WIDTH = 340;
const TARGET_GAP = 14;
const VIEWPORT_MARGIN = 12;

function computePosition(
  target: Element,
  chatboxHeight: number,
  viewportWidth: number,
  viewportHeight: number
): Position {
  const rect = target.getBoundingClientRect();
  const spaceBelow = viewportHeight - rect.bottom;
  const spaceAbove = rect.top;

  const placedAbove =
    spaceBelow < chatboxHeight + TARGET_GAP + VIEWPORT_MARGIN &&
    spaceAbove > spaceBelow;

  const top = placedAbove
    ? Math.max(VIEWPORT_MARGIN, rect.top - chatboxHeight - TARGET_GAP)
    : Math.min(
        viewportHeight - chatboxHeight - VIEWPORT_MARGIN,
        rect.bottom + TARGET_GAP
      );

  const idealLeft = rect.left + rect.width / 2 - CHATBOX_WIDTH / 2;
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(viewportWidth - CHATBOX_WIDTH - VIEWPORT_MARGIN, idealLeft)
  );

  return { top, left, placedAbove };
}

/**
 * Low-level rendering primitive: positions a card relative to a target Element,
 * renders it through a portal, and lays out title/body/actions/footer.
 *
 * Used by both `TourChatbox` (tour mode) and `ClaireFieldAdvisorCard`
 * (field-advisor mode). Stays purely visual — caller owns lifecycle.
 */
export function AdvisorCardShell({
  target,
  content,
  canExit = true,
  onDismiss,
  showAdvanceButton,
  onAdvance,
}: AdvisorCardShellProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<Position | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      if (!ref.current) return;
      const h = ref.current.offsetHeight || 120;
      setPos(computePosition(target, h, window.innerWidth, window.innerHeight));
    };
    update();

    const ro = new ResizeObserver(update);
    ro.observe(target);
    if (ref.current) ro.observe(ref.current);

    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [target]);

  if (typeof document === 'undefined') return null;

  // If a Radix dialog is open, render inside its portal container rather than
  // document.body. Radix's DismissableLayer blocks pointer events on elements
  // that are siblings of its portal in body; rendering inside the same portal
  // container makes the chatbox part of the modal DOM context so clicks land.
  const dialogContent = document.querySelector('[data-radix-dialog-content]');
  const portalTarget =
    dialogContent?.closest<Element>('[data-radix-portal]') ?? document.body;

  return createPortal(
    <div
      ref={ref}
      data-claire-chatbox=""
      data-claire-advisor-active={content.activeMarker}
      role="dialog"
      aria-label={content.title}
      className={cn(
        'fixed z-[100001]',
        'rounded-xl border bg-background shadow-xl',
        'p-4 text-sm'
      )}
      style={{
        width: CHATBOX_WIDTH,
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        opacity: pos ? 1 : 0,
        transition: 'opacity 120ms ease-out',
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <MessageCircle className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          {content.title ? (
            <div className="pr-6 text-sm font-semibold leading-tight">
              {content.title}
            </div>
          ) : null}
          {content.body ? (
            <p
              className={cn(
                'whitespace-pre-line text-sm text-foreground/90 leading-snug',
                content.title ? 'mt-1' : 'pr-6'
              )}
            >
              {content.body}
            </p>
          ) : null}
          {content.actions && content.actions.length > 0 ? (
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              {content.actions.map((a) => (
                <Button
                  key={a.label}
                  size="sm"
                  variant={a.variant ?? 'default'}
                  disabled={a.disabled}
                  onClick={a.onClick}
                >
                  {a.label}
                </Button>
              ))}
            </div>
          ) : null}
          {showAdvanceButton && onAdvance ? (
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={onAdvance}>
                Got it
              </Button>
            </div>
          ) : null}
          {content.footer ? <div className="mt-3">{content.footer}</div> : null}
        </div>
        {canExit && onDismiss ? (
          <button
            type="button"
            aria-label="Dismiss"
            onClick={onDismiss}
            className={cn(
              'absolute right-2 top-2 inline-flex size-7 items-center justify-center rounded-md',
              'text-muted-foreground hover:bg-accent hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
            )}
          >
            <X className="size-4" />
          </button>
        ) : null}
      </div>
    </div>,
    portalTarget
  );
}
