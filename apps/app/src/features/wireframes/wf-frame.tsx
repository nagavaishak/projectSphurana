'use client';

/**
 * The wireframe harness — and the reason it exists.
 *
 * The first pass put the scaffolding INSIDE the screen: a note banner at the
 * top, rationale cards between sections, and state switchers that appended
 * every variant one under another. The result was an inventory rather than a
 * design — you could read what the screen was meant to do, but you could never
 * see what it would actually look like, because it was never showing one state
 * at a time and it was never free of commentary.
 *
 * So the rule here is absolute: **the canvas contains only the product.**
 *
 *   - Chrome lives in a floating bar pinned to the bottom, over the top of the
 *     page. It disturbs no layout — a dashboard page keeps its real sidebar and
 *     real spacing, and a full-screen funnel still owns the whole viewport.
 *   - States REPLACE. `WfFrame` owns the active state and hands it down; a page
 *     renders exactly one. Never two stacked for comparison.
 *   - Notes open in a drawer, one click away and never in frame.
 *
 * If a page needs a rationale card rendered inline to be understood, that is a
 * signal the design is not carrying its own meaning yet.
 */

import { InfoIcon, XIcon } from 'lucide-react';
import { type ReactNode, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

export interface WfState {
  id: string;
  label: string;
}

interface WfFrameProps {
  /** Shown in the bar. The surface's name, not the page title. */
  name: string;
  /** Where this lives in the product — e.g. "Clients › record › Clinical". */
  location?: string;
  /**
   * The states this screen has. One is active at a time and the page renders
   * only that one; the bar switches between them.
   */
  states?: WfState[];
  activeState?: string;
  onState?: (id: string) => void;
  /** Opens in a drawer. Never rendered in the canvas. */
  notes?: ReactNode;
  children: ReactNode;
}

export function WfFrame({
  name,
  location,
  states,
  activeState,
  onState,
  notes,
  children,
}: WfFrameProps) {
  const [notesOpen, setNotesOpen] = useState(false);

  return (
    <>
      {children}

      {/*
        Fixed, floating, and deliberately small. It sits above the page rather
        than in its flow, so nothing about the screen's own layout — sidebar
        width, content max-width, vertical rhythm — is altered by its presence.
      */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-3">
        <div className="pointer-events-auto flex max-w-[calc(100vw-1.5rem)] items-center gap-1 overflow-x-auto rounded-full border bg-background/95 p-1 pl-3 shadow-lg backdrop-blur">
          <span className="whitespace-nowrap font-medium text-xs">{name}</span>
          {location ? (
            <span className="hidden whitespace-nowrap text-muted-foreground text-xs sm:inline">
              · {location}
            </span>
          ) : null}

          {states && states.length > 1 ? (
            <span className="ml-2 flex items-center gap-1">
              {states.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onState?.(s.id)}
                  className={cn(
                    'whitespace-nowrap rounded-full px-2.5 py-1 font-medium text-xs transition-colors',
                    s.id === activeState
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  )}
                >
                  {s.label}
                </button>
              ))}
            </span>
          ) : null}

          {notes ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-1 h-7 rounded-full px-2.5"
              onClick={() => setNotesOpen(true)}
            >
              <InfoIcon className="size-3.5" />
              <span className="text-xs">Notes</span>
            </Button>
          ) : null}
        </div>
      </div>

      {notes ? (
        <Sheet open={notesOpen} onOpenChange={setNotesOpen}>
          <SheetContent className="w-full overflow-y-auto sm:max-w-md">
            <SheetHeader>
              <SheetTitle>{name}</SheetTitle>
              <SheetDescription>
                {location ?? 'Design notes for this surface.'}
              </SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-8 text-sm leading-relaxed [&_strong]:font-semibold">
              {notes}
            </div>
          </SheetContent>
        </Sheet>
      ) : null}
    </>
  );
}

/**
 * A note paragraph with a heading, for the drawer. Kept here so every page's
 * notes read the same way and nobody reinvents a card for them.
 */
export function WfPoint({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="font-semibold">{title}</p>
      <p className="text-muted-foreground">{children}</p>
    </div>
  );
}

/**
 * The one piece of chrome allowed inside a full-screen funnel: a close control.
 * A funnel that cannot be left is a trap, and the sidebar is not there to
 * provide the exit.
 */
export function WfFunnelClose({ onClose }: { onClose?: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className="size-8"
      onClick={onClose}
      aria-label="Close"
    >
      <XIcon className="size-4" />
    </Button>
  );
}
