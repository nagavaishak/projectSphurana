'use client';

/**
 * §20 — clients in the command palette, and the filter page.
 *
 * ## What ships, and the collision in it
 *
 * ⌘K already exists and already searches three things: conversations, ad
 * campaigns and appointments. It groups conversations under the heading
 * "People", which is the problem worth naming — typing "Sarah" today returns
 * her Messenger thread and nothing else. A receptionist reads a People group,
 * sees one Sarah, and concludes the clinic has one Sarah on file.
 *
 * So the delta is not "add search". It is: leads become a fourth source, and
 * the existing conversation group stops being called People.
 *
 * ## The palette is drawn where it actually appears
 *
 * ⌘K is an overlay: it dims what you were looking at, sits near the top of the
 * viewport, and takes the keyboard. So it is drawn over a real dimmed page, and
 * idle and results are two states of one palette rather than two cards.
 *
 * ## Every row carries its disambiguator
 *
 * Two Sarah Murphys, one Sarah Murray and a Sara Mahmood — that is a normal
 * clinic, not an edge case. A result row that is only a name is unusable, so
 * the phone number, email and last visit are on every row and the name alone
 * never appears.
 *
 * ## Filters are a different screen
 *
 * "Find this person" and "find everyone who had Botox and has not been back"
 * are different jobs. The palette answers the first in one keystroke; the
 * second is a page with a result set you export.
 */

import { CalendarIcon, ScissorsIcon, UserIcon } from 'lucide-react';
import { useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { WfFrame, WfPoint } from '../wf-frame';
import {
  FILTERED_CLIENTS,
  FILTER_SOURCES,
  FILTER_TAGS,
  FILTER_TREATMENTS,
  SEARCH_BOOKINGS,
  SEARCH_BOOKING_TOTAL,
  SEARCH_CLIENTS,
  SEARCH_CLIENT_TOTAL,
  SEARCH_QUICK_ACTIONS,
  SEARCH_RECENT,
  SEARCH_TREATMENTS,
  SEARCH_TREATMENT_TOTAL,
} from './mock';

type ViewId = 'idle' | 'results' | 'filters';

const VIEWS = [
  { id: 'idle', label: 'Palette, idle' },
  { id: 'results', label: 'Palette, typing' },
  { id: 'filters', label: 'Client filters' },
];

export function WfSearch() {
  const [view, setView] = useState<ViewId>('results');

  return (
    <WfFrame
      name="Search"
      location="Anywhere · ⌘K"
      states={VIEWS}
      activeState={view}
      onState={(id) => setView(id as ViewId)}
      notes={
        <>
          <WfPoint title="The palette already exists — clients are what is missing">
            ⌘K ships today and searches conversations, campaigns and
            appointments. Only the Clients group is new.
          </WfPoint>
          <WfPoint title="“People” currently means message threads">
            The live palette files conversations under People. Typing a client’s
            name returns her Messenger thread and no record, which reads as
            “this person has no file”. That group needs renaming to
            Conversations the day clients appear beside it.
          </WfPoint>
          <WfPoint title="Drawn as an overlay, because that is what it is">
            A palette rendered as a card in the page flow tells you nothing
            about how it feels. Over a dimmed page you can see whether five
            results per group is the right cap and whether the footer row is
            reachable without scrolling.
          </WfPoint>
          <WfPoint title="No row is just a name">
            Two Sarah Murphys is the normal case. Phone, email and last visit go
            on every row; the tag chip carries the one fact that changes what
            you do — “Lapsed”, “Allergy: lidocaine”.
          </WfPoint>
          <WfPoint title="Five per group, with the real total in the footer">
            “Show all 23 clients” is honest about what is hidden. A capped list
            with no count reads as the complete answer.
          </WfPoint>
          <WfPoint title="The idle state is not empty">
            Recent records and four quick actions. An empty palette waiting for
            input wastes the most common case — going back to the patient you
            were on ten minutes ago.
          </WfPoint>
          <WfPoint title="Filters are a separate page">
            Different job, different result set, and the output is a CSV rather
            than a jump to one record.
          </WfPoint>
          <WfPoint title="Prerequisite">
            The palette exists in the app today and does not search clients at
            all. §22 requires results inside 500 ms, which needs an index on
            name, phone, email and tag.
          </WfPoint>
        </>
      }
    >
      {view === 'filters' ? (
        <Filters />
      ) : (
        <Palette typed={view === 'results'} />
      )}
    </WfFrame>
  );
}

/* --------------------------------------------------------------- palette -- */

function Palette({ typed }: { typed: boolean }) {
  return (
    <>
      {/* The page the user was on. Dimmed and inert — it is context, not
          content, and nothing in it is reachable while the palette is open. */}
      <div aria-hidden="true" className="pointer-events-none select-none">
        <DashboardPage
          title="Today"
          description="Tuesday 2 September · 14 appointments · 11 confirmed"
        >
          <div className="divide-y rounded-xl border">
            {[
              ['09:15', 'Sara Mahmood', 'Profhilo, session 2 of 2'],
              ['10:30', 'Sarah Murphy', 'Anti-Wrinkle Injections, 3 Areas'],
              ['11:45', 'Marta Kowalczyk', 'Skin Booster — Face'],
              ['14:00', 'Hannah Wright', 'Dermal Filler — Lips 1ml'],
            ].map(([time, name, treatment]) => (
              <div key={time} className="flex items-center gap-5 px-5 py-4">
                <span className="w-14 tabular-nums">{time}</span>
                <span className="font-medium">{name}</span>
                <span className="text-muted-foreground text-sm">
                  {treatment}
                </span>
              </div>
            ))}
          </div>
        </DashboardPage>
      </div>

      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px]" />

      <div className="fixed inset-x-4 top-[12vh] z-40 mx-auto max-w-2xl overflow-hidden rounded-xl border bg-popover shadow-2xl">
        {/* cmdk's own filtering is off: these fixtures stand in for a server
            result set, and letting the client re-filter them would drop the
            treatment group the moment you typed a patient's name. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search clients, bookings and treatments"
            value={typed ? 'sarah' : ''}
          />
          <CommandList className="max-h-[420px]">
            {typed ? <TypedResults /> : <IdleResults />}
          </CommandList>
        </Command>
      </div>
    </>
  );
}

function IdleResults() {
  return (
    <>
      <CommandGroup heading="Recent">
        {SEARCH_RECENT.map((row) => (
          <CommandItem key={row.name} value={row.name}>
            <span className="min-w-0">
              <span className="block truncate">{row.name}</span>
              <span className="block truncate text-muted-foreground text-xs">
                {row.secondary}
              </span>
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
      <CommandSeparator />
      <CommandGroup heading="Jump to">
        {SEARCH_QUICK_ACTIONS.map((action) => (
          <CommandItem key={action} value={action}>
            {action}
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  );
}

function TypedResults() {
  return (
    <>
      <CommandGroup heading={`Clients · ${SEARCH_CLIENT_TOTAL}`}>
        {SEARCH_CLIENTS.map((row) => (
          <CommandItem key={row.secondary} value={row.secondary}>
            <UserIcon className="text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{row.name}</span>
              <span className="block truncate text-muted-foreground text-xs">
                {row.secondary}
              </span>
            </span>
            {row.tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
          </CommandItem>
        ))}
        <CommandItem value="show-all-clients" className="text-muted-foreground">
          Show all {SEARCH_CLIENT_TOTAL} clients
        </CommandItem>
      </CommandGroup>

      <CommandSeparator />

      <CommandGroup heading={`Bookings · ${SEARCH_BOOKING_TOTAL}`}>
        {SEARCH_BOOKINGS.map((row) => (
          <CommandItem key={row.title} value={row.title}>
            <CalendarIcon className="text-muted-foreground" />
            <span className="min-w-0 flex-1">
              <span className="block truncate">{row.title}</span>
              <span className="block truncate text-muted-foreground text-xs">
                {row.secondary}
              </span>
            </span>
            <Badge variant="outline">{row.status}</Badge>
          </CommandItem>
        ))}
      </CommandGroup>

      <CommandSeparator />

      <CommandGroup heading={`Treatments · ${SEARCH_TREATMENT_TOTAL}`}>
        {SEARCH_TREATMENTS.map((row) => (
          <CommandItem key={row.name} value={row.name}>
            <ScissorsIcon className="text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate">{row.name}</span>
              <span className="block truncate text-muted-foreground text-xs">
                {row.secondary}
              </span>
            </span>
          </CommandItem>
        ))}
      </CommandGroup>
    </>
  );
}

/* --------------------------------------------------------------- filters -- */

function Filters() {
  return (
    <DashboardPage
      title="Clients"
      description="412 clients · 5 match the filters below"
      actions={
        <Button variant="outline" size="sm">
          Export 5 clients as CSV
        </Button>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <div className="space-y-6">
          <FilterGroup title="Tag" options={FILTER_TAGS.slice(0, 5)} />
          <FilterGroup
            title="Has had"
            options={FILTER_TREATMENTS.slice(0, 4)}
          />
          <FilterGroup title="Came from" options={FILTER_SOURCES.slice(0, 4)} />

          <div className="space-y-2">
            <p className="font-medium text-sm">Spent</p>
            <div className="flex items-center gap-2">
              <Input placeholder="£0" aria-label="Minimum spend" />
              <span className="text-muted-foreground text-sm">to</span>
              <Input placeholder="Any" aria-label="Maximum spend" />
            </div>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Came from</TableHead>
                <TableHead className="w-[130px]">Last visit</TableHead>
                <TableHead className="w-[110px] text-right">Spent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {FILTERED_CLIENTS.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.name}
                    <span className="block font-normal text-muted-foreground text-xs">
                      {row.phone}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.source}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.lastVisit}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {row.totalSpend}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </DashboardPage>
  );
}

function FilterGroup({
  title,
  options,
}: {
  title: string;
  options: string[];
}) {
  return (
    <div className="space-y-2">
      <p className="font-medium text-sm">{title}</p>
      {options.map((option) => (
        <Label
          key={option}
          className="flex items-start gap-2 font-normal text-muted-foreground text-sm"
        >
          <Checkbox />
          {option}
        </Label>
      ))}
    </div>
  );
}
