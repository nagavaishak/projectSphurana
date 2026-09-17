'use client';

/**
 * The shared full-page entity VIEW — sibling of `entity-editor`.
 *
 * Both the client record and the appointment full view render through this, so
 * a create → view → edit journey keeps one header, one tab idiom and one set of
 * spacing. Building either page on its own is how an app ends up with two
 * subtly different headers and no way back.
 *
 * ## The frame is the editor's, to the pixel
 *
 * `entity-editor` takes its numbers from Figma 3105:8141 — a 1079px centred
 * column, a 269px aside, 32px between the columns. Those are reused here
 * exactly, so switching between viewing and editing an entity does not shift
 * the page.
 *
 * ## Why tabs and not the editor's left rail
 *
 * The editor's section rail works because a form has few sections and you walk
 * them in order. A record has eleven tabs you jump between, and a left rail
 * puts a second vertical nav beside the app sidebar. Reviewed as options A/B/C
 * at `/dashboard/wireframes/view-shell`; C was chosen.
 *
 * ## No page background of its own
 *
 * `PageShell` and `entity-editor` set none — they inherit from the dashboard
 * layout. An earlier version painted the body `bg-muted/20` and the header
 * `bg-background`, which produced a white band across the top that matched
 * nothing else in the app. Only cards carry a surface colour.
 *
 * ## Tabs become a select on mobile
 *
 * Eleven tabs wrapped onto FOUR rows on a 375px screen — ~360px of navigation
 * before any content. An earlier version of this file called that "ugly and
 * honest"; it was measured afterwards and it is neither. Below `md` the strip
 * collapses to a single select showing the current tab, which is one line and
 * keeps the panel above the fold.
 *
 * ## The aside does not change with the tab
 *
 * That is the argument for it. Reading a clinical note while the deposit and
 * consent state stay on screen is what the appointment side panel does well
 * today and what a full-width page throws away. Anything that changes per tab
 * belongs in the panel, not here.
 */

import { ArrowLeftIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import type { EntityViewConfig } from './entity-view-types';

export function EntityView({
  config,
  children,
}: {
  config: EntityViewConfig;
  children: ReactNode;
}) {
  const { identity, back, actions, tabs, activeTab, onTabChange, aside } =
    config;

  return (
    <div className="min-h-svh">
      {/*
        Header and tabs are ONE sticky unit. Scrolling a long panel — an
        appointment list, a note — should never leave you unsure whose record
        you are in or which tab you are on.

        `bg-sidebar` — the same token the app sidebar uses — so the chrome
        reads as one continuous band across the top rather than a white panel
        floating beside a tinted rail. The BODY keeps `SidebarInset`'s
        `bg-background`: chrome is one surface, content is another, and cards
        sit on the content one.
      */}
      <div className="sticky top-0 z-20 border-b bg-sidebar">
        <div className="mx-auto w-full max-w-[1079px] px-6 pt-6 pb-5 md:px-0">
          {back ? (
            <button
              type="button"
              onClick={back.onClick}
              className="mb-4 inline-flex items-center gap-1.5 text-muted-foreground text-sm transition-colors hover:text-foreground"
            >
              <ArrowLeftIcon className="size-4" />
              {back.label}
            </button>
          ) : null}

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-4">
              {identity.initials ? (
                <Avatar className="size-12 shrink-0">
                  <AvatarFallback className="bg-muted font-semibold">
                    {identity.initials}
                  </AvatarFallback>
                </Avatar>
              ) : null}
              <div className="min-w-0">
                <h1 className="truncate font-semibold text-2xl leading-tight">
                  {identity.title}
                </h1>
                {identity.subtitle ? (
                  <p className="mt-0.5 text-muted-foreground text-sm">
                    {identity.subtitle}
                  </p>
                ) : null}
                {identity.status ? (
                  <div className="mt-2">{identity.status}</div>
                ) : null}
              </div>
            </div>
            {actions ? (
              <div className="flex shrink-0 gap-2">{actions}</div>
            ) : null}
          </div>
        </div>

        <div className="mx-auto w-full max-w-[1079px] px-6 pb-3 md:px-0 md:pb-0">
          {/* Mobile: one line, current tab visible, the rest a tap away. */}
          <div className="md:hidden">
            <Select value={activeTab} onValueChange={onTabChange}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {tabs.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop: wraps rather than scrolls — a hidden tab is a tab
              nobody finds, and at 1079px eleven fit on two rows.

              `tablist` / `tab` / `aria-selected` are NOT decoration. This
              strip replaced a shadcn `Tabs` on the client record, and bare
              buttons silently dropped the roles that came with it — screen
              readers lost "tab 3 of 11", and anything selecting by role
              stopped finding them at all. */}
          <div
            className="hidden flex-wrap gap-x-1 md:flex"
            role="tablist"
            aria-label="Sections"
          >
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === activeTab}
                onClick={() => onTabChange(t.id)}
                className={cn(
                  '-mb-px flex items-center gap-2 border-b-2 px-3 py-3 font-medium text-sm transition-colors',
                  t.id === activeTab
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                )}
              >
                {t.label}
                {t.badge}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-[1079px] flex-col gap-8 px-6 py-8 md:flex-row md:px-0">
        <main className="min-w-0 flex-1">{children}</main>
        {aside ? (
          <aside className="w-full shrink-0 md:w-[269px]">{aside}</aside>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The aside's standard shape: a titled card of label/value facts. Features can
 * pass anything, but using this keeps every entity's aside recognisable.
 */
export function EntityViewAside({
  title = 'At a glance',
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-4 rounded-xl border bg-background p-5">
      <h2 className="font-medium text-sm">{title}</h2>
      {children}
    </div>
  );
}
