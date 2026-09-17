'use client';

/**
 * §13 — retention.
 *
 * ## The page answers one question
 *
 * "Who is slipping away, and what do I do about it?" The first version opened
 * with eight metric tiles, which is a wall of numbers before the owner has read
 * a single name — and none of the eight change what you do next. Active clients,
 * average visits and average revenue are report figures; they now live in the
 * one sentence under the title and in a link to the client report.
 *
 * What survives is the shape of the answer: four lists, one visible at a time,
 * each with the column that makes its rows sortable by urgency.
 *
 * ## Selection is per list, deliberately
 *
 * Switching tabs clears the selection. A bulk send that silently spanned two
 * definitions of "overdue" is exactly how a patient gets messaged twice, and
 * the guardrail costs one line of state.
 */

import { ChevronRightIcon, SendIcon } from 'lucide-react';
import { useState } from 'react';

import { DashboardPage } from '@/components/app/dashboard-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

import { WfFrame, WfPoint } from '../wf-frame';
import {
  ACTIVITY_STAGES,
  DUE_ROWS,
  LAPSED_ROWS,
  LOST_ROWS,
  PROMPT_STATUS_LABEL,
  RECENT_ACTIVITY,
  TREATMENT_PERF,
} from './mock';

type ViewId = 'due' | 'slipping' | 'treatments' | 'activity';

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'due', label: `Due to rebook (${DUE_ROWS.length})` },
  {
    id: 'slipping',
    label: `Lapsed & lost (${LAPSED_ROWS.length + LOST_ROWS.length})`,
  },
  { id: 'treatments', label: 'Treatments' },
  { id: 'activity', label: 'Recent prompts' },
];

export function WfRetention() {
  const [view, setView] = useState<ViewId>('due');

  return (
    <WfFrame
      name="Retention"
      location="Growth › Retention"
      states={VIEWS.map((v) => ({ id: v.id, label: v.label }))}
      activeState={view}
      onState={(id) => setView(id as ViewId)}
      notes={
        <>
          <WfPoint title="Eight tiles became one sentence">
            Active clients, new, returning, retention rate, average visits and
            average revenue are all report figures — nothing you would act on
            from this page. The two counts that DO drive action are the tab
            labels, where they are attached to the list they open.
          </WfPoint>
          <WfPoint title="Lapsed and lost are one list">
            They differ by a threshold, not by what you do about them. Splitting
            them into two tabs made the owner check both to find the same
            answer; one list sorted by days since, with the boundary marked,
            reads in a single pass.
          </WfPoint>
          <WfPoint title="The bulk bar only exists when there is a selection">
            A permanently-visible “Send to 0 patients” toolbar is furniture. It
            appears on first tick and carries the count, because §13 requires
            the “you are about to message 12 patients” guardrail before send.
          </WfPoint>
          <WfPoint title="Switching tabs clears the selection">
            “Due for rebooking” and “Lapsed” are different definitions of
            overdue. Carrying ticks across them is how someone gets two
            messages.
          </WfPoint>
          <WfPoint title="Open question">
            “Lapsed” means three different things across §12.3, §13 and §14. The
            30-day catch-all and the win-back sequence both fire on the same
            patient today.
          </WfPoint>
        </>
      }
    >
      <DashboardPage
        title="Retention"
        description="412 active clients. 71% of the people you saw three months ago have been back — up 3 points on last quarter."
        actions={
          <Select defaultValue="90">
            <SelectTrigger className="w-[160px]" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last 12 months</SelectItem>
            </SelectContent>
          </Select>
        }
      >
        <Tabs value={view} onValueChange={(v) => setView(v as ViewId)}>
          <TabsList>
            {VIEWS.map((v) => (
              <TabsTrigger key={v.id} value={v.id}>
                {v.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {view === 'due' ? <DueList /> : null}
        {view === 'slipping' ? <SlippingList /> : null}
        {view === 'treatments' ? <TreatmentList /> : null}
        {view === 'activity' ? <ActivityFeed /> : null}

        <Button variant="link" className="self-start px-0">
          See the full client report
          <ChevronRightIcon className="size-4" />
        </Button>
      </DashboardPage>
    </WfFrame>
  );
}

/* ------------------------------------------------------------------- due -- */

function DueList() {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id]
    );

  return (
    <div className="space-y-3">
      {/* Appears on the first tick and never before it. */}
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-muted/40 px-4 py-3">
          <span className="font-medium text-sm">
            {selected.length} selected
          </span>
          <Button size="sm">
            <SendIcon className="size-4" />
            Preview and send
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
            Clear
          </Button>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[44px]" />
              <TableHead>Patient</TableHead>
              <TableHead>Last treatment</TableHead>
              <TableHead className="w-[130px] text-right">Overdue by</TableHead>
              <TableHead className="w-[170px]">Prompt</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {DUE_ROWS.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Checkbox
                    checked={selected.includes(row.id)}
                    onCheckedChange={() => toggle(row.id)}
                    aria-label={`Select ${row.name}`}
                  />
                </TableCell>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {row.lastTreatment}
                  <span className="block text-xs">
                    Last visit {row.lastVisit}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {row.daysOverdue} days
                </TableCell>
                {/* Muted text, not a badge. Six coloured pills in a column
                    reads as six problems; only "No response" is one. */}
                <TableCell
                  className={cn(
                    'text-sm',
                    row.status === 'ignored'
                      ? 'text-foreground'
                      : 'text-muted-foreground'
                  )}
                >
                  {PROMPT_STATUS_LABEL[row.status]}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- slipping -- */

function SlippingList() {
  const rows = [
    ...LAPSED_ROWS.map((row) => ({ ...row, lost: false })),
    ...LOST_ROWS.map((row) => ({ ...row, lost: true })),
  ].sort((a, b) => a.daysSince - b.daysSince);

  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Patient</TableHead>
            <TableHead>Last treatment</TableHead>
            <TableHead className="w-[140px] text-right">Not seen for</TableHead>
            <TableHead className="w-[130px] text-right">
              Spent to date
            </TableHead>
            <TableHead className="w-[120px]" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">
                {row.name}
                {row.lost ? (
                  <Badge variant="outline" className="ml-2 align-middle">
                    Lost
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell className="text-muted-foreground">
                {row.lastTreatment}
                <span className="block text-xs">
                  Last visit {row.lastVisit}
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.daysSince} days
              </TableCell>
              {/* Lifetime spend is the whole reason to work this list top-down:
                  a £3,415 patient earns a phone call, a £455 one earns a text. */}
              <TableCell className="text-right font-medium tabular-nums">
                {row.lifetimeSpend}
              </TableCell>
              <TableCell className="text-right">
                <Button size="sm" variant="outline">
                  Win back
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* ------------------------------------------------------------ treatments -- */

function TreatmentList() {
  return (
    <div className="overflow-hidden rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Treatment</TableHead>
            <TableHead className="w-[110px] text-right">Patients</TableHead>
            <TableHead className="w-[200px]">Rebooked</TableHead>
            <TableHead className="w-[150px] text-right">Per patient</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {TREATMENT_PERF.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.treatment}</TableCell>
              <TableCell className="text-right tabular-nums">
                {row.patients}
              </TableCell>
              <TableCell>
                {/* The bar carries the comparison the number alone cannot:
                    78% against 31% is the finding on this table. */}
                <span className="flex items-center gap-3">
                  <span
                    className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                    aria-hidden="true"
                  >
                    <span
                      className="block h-full rounded-full bg-primary"
                      style={{ width: `${row.rebookingRate}%` }}
                    />
                  </span>
                  <span className="w-10 text-right tabular-nums">
                    {row.rebookingRate}%
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.revenuePerPatient}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/* -------------------------------------------------------------- activity -- */

function ActivityFeed() {
  return (
    <div className="divide-y rounded-xl border">
      {RECENT_ACTIVITY.map((row) => (
        <div key={row.id} className="px-5 py-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-medium">
              {row.name}
              <span className="ml-2 font-normal text-muted-foreground text-sm">
                {row.treatment}
              </span>
            </p>
            <p className="text-muted-foreground text-sm">{row.when}</p>
          </div>

          {/* Five dots, not five badges. "Delivered but never read" and "read
              and ignored" are different problems, and one status pill collapses
              them into "no response". */}
          <div className="mt-2.5 flex items-center gap-1.5">
            {ACTIVITY_STAGES.map((stage, index) => (
              <span
                key={stage}
                className={cn(
                  'h-1 w-8 rounded-full',
                  index < row.reached ? 'bg-primary' : 'bg-muted'
                )}
                aria-hidden="true"
              />
            ))}
            <span className="ml-2 text-muted-foreground text-sm">
              {row.outcome}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
