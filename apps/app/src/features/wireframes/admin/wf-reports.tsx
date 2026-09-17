'use client';

/**
 * §18 — reporting.
 *
 * ## One report at a time
 *
 * The first version rendered all four report areas down a single page: sixteen
 * metric tiles, six tables and four charts. Nobody reads a report that way. The
 * four are separate questions asked on separate days — "did we make money",
 * "are clients coming back", "what should we push", "are the ads working" — so
 * only one is on screen.
 *
 * ## Four tiles became three
 *
 * A tile earns its place by changing a decision. "This quarter vs last" is the
 * same fact as "this month vs last" at a longer horizon, and neither of them is
 * why anyone opened the page; the month comparison stayed and the quarter went
 * into the chart it was summarising.
 *
 * ## One table with a breakdown selector, not three tables
 *
 * Revenue by treatment, by practitioner and by payment type are the same table
 * with a different grouping. Stacked they are 20 rows of near-identical
 * chrome; as a selector they are one table you re-cut.
 */

import { DownloadIcon } from 'lucide-react';
import { useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import { WfChart } from '../wf-kit';
import {
  CAMPAIGN_ROI,
  CLIENT_TILES,
  COHORTS,
  COHORT_MONTHS,
  COMPARISON_OPTIONS,
  DATE_PRESETS,
  MARKETING_FUNNEL,
  MARKETING_TILES,
  NEW_CLIENTS_BY_SOURCE,
  REVENUE_BY_PAYMENT_TYPE,
  REVENUE_BY_PRACTITIONER,
  REVENUE_BY_TREATMENT,
  REVENUE_TILES,
  type ReportTile,
  TREATMENT_PERFORMANCE,
} from './mock';

type ViewId = 'revenue' | 'clients' | 'treatments' | 'marketing';

const VIEWS = [
  { id: 'revenue', label: 'Revenue' },
  { id: 'clients', label: 'Clients' },
  { id: 'treatments', label: 'Treatments' },
  { id: 'marketing', label: 'Marketing' },
];

export function WfReports() {
  const [view, setView] = useState<ViewId>('revenue');

  return (
    <WfFrame
      name="Reports"
      location="Reports"
      states={VIEWS}
      activeState={view}
      onState={(id) => setView(id as ViewId)}
      notes={
        <>
          <WfPoint title="Four reports, never at once">
            They answer four questions asked on different days. Stacked, the
            page was sixteen tiles and six tables and you had to scroll past
            three reports to reach the one you wanted.
          </WfPoint>
          <WfPoint title="Three tiles per report, not four">
            A tile has to change a decision. “This quarter vs last” restates the
            month comparison at a longer horizon — that is what the chart under
            it is for.
          </WfPoint>
          <WfPoint title="Revenue is one table, re-cut">
            By treatment, by practitioner and by payment type are three
            groupings of the same money. A selector says that; three stacked
            tables hide it.
          </WfPoint>
          <WfPoint title="Deposits are marked as double-counted">
            A deposit is a payment-type row AND part of the treatment revenue it
            is later deducted from. Summing that column silently overstates the
            month, so the row carries the warning rather than a footnote nobody
            reads (§27).
          </WfPoint>
          <WfPoint title="“Most profitable treatment” is not computable">
            Nothing in the system captures cost — product, consumables, room
            time. Until it does, this tab reports revenue and rebooking, and
            says so.
          </WfPoint>
        </>
      }
    >
      <DashboardPage
        title="Reports"
        description="Harley Aesthetics · all figures include VAT."
        actions={
          <Button variant="outline" size="sm">
            <DownloadIcon className="size-4" />
            Export CSV
          </Button>
        }
        toolbar={
          <div className="flex flex-wrap gap-2">
            <Select defaultValue={DATE_PRESETS[2]}>
              <SelectTrigger className="w-[170px]" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_PRESETS.map((preset) => (
                  <SelectItem key={preset} value={preset}>
                    {preset}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select defaultValue={COMPARISON_OPTIONS[1]}>
              <SelectTrigger className="w-[200px]" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPARISON_OPTIONS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {view === 'revenue' ? <Revenue /> : null}
        {view === 'clients' ? <Clients /> : null}
        {view === 'treatments' ? <Treatments /> : null}
        {view === 'marketing' ? <Marketing /> : null}
      </DashboardPage>
    </WfFrame>
  );
}

/* ----------------------------------------------------------------- tiles -- */

function Tiles({ tiles }: { tiles: ReportTile[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {tiles.slice(0, 3).map((tile) => (
        <div key={tile.label} className="rounded-xl border p-5">
          <p className="text-muted-foreground text-sm">{tile.label}</p>
          <p className="mt-1.5 font-semibold text-2xl tabular-nums">
            {tile.value}
          </p>
          {tile.delta ? (
            /* Colour goes on the CHANGE, never on the number. The number is a
               fact; only its direction is good or bad news. */
            <p
              className={cn(
                'mt-1 text-xs',
                tile.tone === 'good' && 'text-green-600 dark:text-green-400',
                tile.tone === 'bad' && 'text-destructive',
                (tile.tone === 'neutral' || !tile.tone) &&
                  'text-muted-foreground'
              )}
            >
              {tile.delta}
            </p>
          ) : (
            <p className="mt-1 text-muted-foreground text-xs">{tile.sub}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function ShareTable({
  head,
  rows,
  footnote,
}: {
  head: string;
  rows: { name: string; revenue: string; share: number; count?: number }[];
  footnote?: string;
}) {
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{head}</TableHead>
              <TableHead className="w-[100px] text-right">Count</TableHead>
              <TableHead className="w-[180px]">Share</TableHead>
              <TableHead className="w-[120px] text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.name}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {row.count ?? '—'}
                </TableCell>
                <TableCell>
                  <span className="flex items-center gap-3">
                    <span
                      className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${row.share}%` }}
                      />
                    </span>
                    <span className="w-9 text-right text-muted-foreground text-xs tabular-nums">
                      {row.share}%
                    </span>
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.revenue}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {footnote ? (
        <p className="text-muted-foreground text-sm">{footnote}</p>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- revenue -- */

type Breakdown = 'treatment' | 'practitioner' | 'payment';

function Revenue() {
  const [breakdown, setBreakdown] = useState<Breakdown>('treatment');

  return (
    <div className="space-y-6">
      <Tiles tiles={REVENUE_TILES} />

      <WfChart kind="Revenue by day, with the previous 30 days behind it" />

      <div className="flex items-center gap-3">
        <span className="font-medium text-sm">Break down by</span>
        <Select
          value={breakdown}
          onValueChange={(value) => setBreakdown(value as Breakdown)}
        >
          <SelectTrigger className="w-[190px]" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="treatment">Treatment</SelectItem>
            <SelectItem value="practitioner">Practitioner</SelectItem>
            <SelectItem value="payment">Payment type</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {breakdown === 'treatment' ? (
        <ShareTable head="Treatment" rows={REVENUE_BY_TREATMENT} />
      ) : null}
      {breakdown === 'practitioner' ? (
        <ShareTable head="Practitioner" rows={REVENUE_BY_PRACTITIONER} />
      ) : null}
      {breakdown === 'payment' ? (
        <ShareTable
          head="Payment type"
          rows={REVENUE_BY_PAYMENT_TYPE}
          footnote={`Deposits (${
            REVENUE_BY_PAYMENT_TYPE.find((row) => row.doubleCounted)?.revenue ??
            ''
          }) are already counted inside the treatment they were taken against. This column does not sum to total revenue.`}
        />
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- clients -- */

function Clients() {
  return (
    <div className="space-y-6">
      <Tiles tiles={CLIENT_TILES} />

      <ShareTable
        head="Where new clients came from"
        rows={NEW_CLIENTS_BY_SOURCE}
      />

      <div className="space-y-2">
        <h2 className="font-semibold text-lg">Still coming back</h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[130px]">First visit</TableHead>
                <TableHead className="w-[80px] text-right">Clients</TableHead>
                {COHORT_MONTHS.map((month) => (
                  <TableHead key={month} className="text-center">
                    {month}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {COHORTS.map((row) => (
                <TableRow key={row.cohort}>
                  <TableCell className="font-medium">{row.cohort}</TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {row.size}
                  </TableCell>
                  {row.cells.map((cell, index) => (
                    <TableCell
                      key={COHORT_MONTHS[index]}
                      className="p-1 text-center"
                    >
                      {/* Empty rather than "—": the cohort is not old enough,
                          which is different from nobody returning. */}
                      {cell === null ? null : (
                        <span
                          className="block rounded-md py-2 text-xs tabular-nums"
                          style={{
                            backgroundColor: `color-mix(in oklab, var(--primary) ${cell}%, transparent)`,
                          }}
                        >
                          {cell}%
                        </span>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ treatments -- */

function Treatments() {
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Treatment</TableHead>
              <TableHead className="w-[100px] text-right">Performed</TableHead>
              <TableHead className="w-[120px] text-right">Revenue</TableHead>
              <TableHead className="w-[110px] text-right">Rebooked</TableHead>
              <TableHead className="w-[110px] text-right">No-shows</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {TREATMENT_PERFORMANCE.map((row) => (
              <TableRow key={row.name}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.performed}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.revenue}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.rebookingRate}%
                </TableCell>
                {/* A 22% no-show rate on consultations is the finding here, so
                    the bad end of the column is the only thing coloured. */}
                <TableCell
                  className={cn(
                    'text-right tabular-nums',
                    row.noShowRate >= 15 && 'text-destructive'
                  )}
                >
                  {row.noShowRate}%
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground text-sm">
        “Most profitable” is not on this table because nothing records what a
        treatment costs to deliver — product, consumables and room time are not
        captured anywhere yet.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------- marketing -- */

function Marketing() {
  const top = MARKETING_FUNNEL[0].value;

  return (
    <div className="space-y-6">
      <Tiles tiles={MARKETING_TILES} />

      <div className="space-y-2 rounded-xl border p-5">
        {MARKETING_FUNNEL.map((stage) => (
          <div key={stage.label} className="flex items-center gap-4">
            <span className="w-44 shrink-0 text-sm">{stage.label}</span>
            <span
              className="h-6 rounded-md bg-primary/80"
              style={{
                width: `${Math.max((stage.value / top) * 100, 2)}%`,
              }}
              aria-hidden="true"
            />
            <span className="font-medium text-sm tabular-nums">
              {stage.value.toLocaleString('en-GB')}
            </span>
            <span className="text-muted-foreground text-xs">
              {stage.caption}
            </span>
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Campaign</TableHead>
              <TableHead className="w-[100px] text-right">Spend</TableHead>
              <TableHead className="w-[110px] text-right">
                New patients
              </TableHead>
              <TableHead className="w-[130px] text-right">Cost each</TableHead>
              <TableHead className="w-[100px] text-right">Return</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {CAMPAIGN_ROI.map((row) => (
              <TableRow key={row.name}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.spend}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.newPatients}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.costPerPatient}
                </TableCell>
                <TableCell className="text-right font-medium tabular-nums">
                  {row.roas}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-muted-foreground text-sm">
        Return counts first-visit revenue only. A patient who comes back four
        times is credited once here, so this is the floor, not the number.
      </p>
    </div>
  );
}
