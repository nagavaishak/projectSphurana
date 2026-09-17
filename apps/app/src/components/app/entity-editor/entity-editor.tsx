'use client';

import { ArrowLeft } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface EntityEditorSection {
  id: string;
  label: string;
  icon?: LucideIcon;
}

interface EntityEditorProps {
  /** "Create Service", "Edit Product" — the page's H1. */
  title: string;
  /**
   * Optional section navigation. One section (or none) renders no nav at all:
   * a list of one is noise.
   */
  sections?: EntityEditorSection[];
  activeSection?: string;
  onSectionChange?: (id: string) => void;
  onCancel: () => void;
  onSave: () => void;
  isSaving?: boolean;
  /**
   * The form cannot be submitted yet — a required field is still empty. Kept
   * separate from `isSaving` so the button reads "Save" (greyed) rather than
   * "Saving…" while the user is simply not finished.
   */
  saveDisabled?: boolean;
  /** Desktop primary-button label. Mobile always reads "Save Changes". */
  saveLabel?: string;
  /**
   * Right-hand column on desktop — the product editor's photo uploader. Stacks
   * under the form on mobile.
   */
  aside?: ReactNode;
  children: ReactNode;
}

/**
 * The one create/edit surface.
 *
 * Replaces three competing patterns — full page (services), dialog (products,
 * promotions, stock orders), and a bespoke multi-panel editor (team member).
 * See docs/plans/location-focused-redesign.md §7.
 *
 * Layout is CSS-responsive rather than branched on `useIsMobile`, so there is
 * one tree and one set of form state. Desktop puts Cancel/Save top-right with a
 * section nav card on the left; mobile puts a back arrow up top, section pills
 * under the title, and a sticky Save bar at the bottom.
 *
 * Desktop spacing is taken from the Figma frame (node 3105:8141): 16px page
 * padding, a 64px-inset action row, a 1079px centred content column, 32px
 * between the title and the body and between the body's columns, and a 269px
 * aside. The magic numbers below are that frame's, not invented.
 */
export function EntityEditor({
  title,
  sections = [],
  activeSection,
  onSectionChange,
  onCancel,
  onSave,
  isSaving = false,
  saveDisabled = false,
  saveLabel = 'Save',
  aside,
  children,
}: EntityEditorProps) {
  const hasNav = sections.length > 1;
  const current = activeSection ?? sections[0]?.id;

  return (
    // Desktop: the page itself does not scroll (`md:h-svh md:overflow-hidden`).
    // The actions, title and section nav are chrome and stay put; only the form
    // column scrolls. Mobile keeps ordinary page scrolling — a nested scroll
    // area on touch fights momentum and the on-screen keyboard.
    <div className="flex min-h-full flex-col md:h-svh md:overflow-hidden">
      {/* Desktop actions: top-right, above the title. px-16 = the frame's 64px. */}
      <div className="hidden shrink-0 justify-end gap-2 px-16 pt-4 md:flex">
        <Button disabled={isSaving} onClick={onCancel} variant="outline">
          Cancel
        </Button>
        <Button
          data-testid="entity-editor-save"
          disabled={isSaving || saveDisabled}
          onClick={onSave}
        >
          {isSaving ? 'Saving…' : saveLabel}
        </Button>
      </div>

      {/* Mobile back affordance. */}
      <div className="px-6 pt-4 md:hidden">
        <Button
          aria-label="Back"
          className="-ml-2"
          onClick={onCancel}
          size="icon"
          variant="ghost"
        >
          <ArrowLeft className="size-5" />
        </Button>
      </div>

      <div className="mx-auto w-full max-w-[1079px] shrink-0 px-6 pt-2 pb-4 md:px-0 md:pt-8 md:pb-8">
        <h1 className="font-semibold text-3xl leading-10 tracking-normal md:text-4xl">
          {title}
        </h1>
      </div>

      {/*
        Mobile section pills — a horizontally SCROLLING row.

        Without `overflow-x-auto` these five pills were simply wider than a
        412px phone, and the consequence was not a stray scrollbar: Chrome's
        mobile shrink-to-fit widens the layout viewport to contain the overflow,
        which took `window.innerHeight` from 839 to 1033 while the visual
        viewport stayed 839. Every `fixed bottom-0` element — the editor's own
        save bar — then anchored to the taller box and rendered ~140px BELOW the
        fold, unreachable. That is why an entity could not be saved on a phone.
        `shrink-0` keeps the pills legible instead of squashing them to fit.
      */}
      {hasNav && (
        <div
          className="flex gap-2 overflow-x-auto px-6 pb-4 md:hidden"
          data-testid="entity-editor-nav"
        >
          {sections.map((section) => (
            <button
              className={cn(
                'shrink-0 whitespace-nowrap rounded-full px-4 py-1.5 font-medium text-sm transition-colors',
                section.id === current
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground'
              )}
              key={section.id}
              onClick={() => onSectionChange?.(section.id)}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </div>
      )}

      <div
        className={cn(
          'mx-auto flex w-full max-w-[1079px] flex-1 flex-col gap-8 px-6 pb-28 md:min-h-0 md:flex-row md:overflow-hidden md:px-0 md:pb-0'
        )}
      >
        {/* Desktop section nav. */}
        {hasNav && (
          <nav
            aria-label="Editor sections"
            className="hidden h-fit w-64 shrink-0 rounded-lg border p-2 md:block"
            data-testid="entity-editor-nav"
          >
            {sections.map((section) => (
              <button
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors',
                  section.id === current
                    ? 'bg-muted font-medium'
                    : 'text-muted-foreground hover:bg-muted/60'
                )}
                key={section.id}
                onClick={() => onSectionChange?.(section.id)}
                type="button"
              >
                {section.icon && <section.icon className="size-4 shrink-0" />}
                <span className="truncate">{section.label}</span>
              </button>
            ))}
          </nav>
        )}

        {/*
          The form column stops growing at the Figma width (1079px content
          minus the 269px aside minus the 32px gap). Without this the fields
          stretch to whatever the window is on a wide monitor, and a 14px label
          over a 1600px input is unreadable. Capping the column — rather than
          only the page — keeps the form identical whether or not the entity
          has an aside.
        */}
        {/*
          The only scrolling region on desktop.

          `pr-6` is a gutter for the scrollbar so it does not sit on top of the
          inputs, and the max-width is Figma's 778px PLUS that 24px — so the
          fields still measure 778px and the design is unchanged; only the
          scroll track lives in the extra space.
        */}
        <div className="min-w-0 flex-1 md:max-w-[802px] md:overflow-y-auto md:pr-6 md:pb-8">
          {children}
        </div>

        {aside && (
          <div className="w-full md:w-[269px] md:shrink-0 md:self-start">
            {aside}
          </div>
        )}
      </div>

      {/*
        Mobile save bar. Fixed rather than sticky so it clears the keyboard and
        does not depend on the scroll container's height, and padded for the
        home indicator.
      */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <Button
          className="ml-auto flex"
          data-testid="entity-editor-save"
          disabled={isSaving || saveDisabled}
          onClick={onSave}
          size="lg"
        >
          {isSaving ? 'Saving…' : 'Save Changes'}
        </Button>
      </div>
    </div>
  );
}

/**
 * A titled block within an editor section ("Service Details", "Pricing and
 * Duration"). Separated by a rule, as in the design.
 */
export function EntityEditorBlock({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'border-b py-8 first:pt-0 last:border-b-0 last:pb-0',
        className
      )}
    >
      {title && (
        <h2 className="pb-1 font-semibold text-xl leading-7">{title}</h2>
      )}
      <div className="mt-[14px] space-y-4">{children}</div>
    </section>
  );
}
