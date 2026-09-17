import type {
  PractitionerWithRelations,
  TimeEntryWithBreaks,
} from '@borradh-workspace/api-client/types';
import {
  timeEntrySourceLabels,
  timeEntryStatusLabels,
} from '@borradh-workspace/api-client/types';
import {
  endOfDay,
  endOfWeek,
  format,
  parse,
  startOfDay,
  startOfWeek,
  subDays,
} from 'date-fns';
import {
  CheckCheck,
  Clock,
  MoreVertical,
  Trash2,
  UserRound,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { ConfirmDeleteDialog } from '@/components/app/confirm-delete-dialog';
import { ListPage } from '@/components/app/list-page';
import type { ListColumn } from '@/components/app/list-page';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useActiveOrganization } from '@/features/organization';
import { useListPractitioners } from '@/features/practitioners';
import { TeamMemberMenu } from '@/features/scheduling';
import { zonedEvent } from '@/lib/timezone';

import {
  useApproveTimeEntry,
  useDeleteTimeEntry,
  useListTimeEntries,
} from '../api';
import {
  formatDurationMs,
  formatHours,
  msToHours,
  totalBreakMs,
  workedMs,
} from '../lib/compute';
import { ClockedInStrip } from './clocked-in-strip';
import { EditTimeEntryDialog } from './edit-time-entry-dialog';

const ALL = 'all';

function statusVariant(
  status: TimeEntryWithBreaks['status']
): 'default' | 'secondary' | 'outline' {
  if (status === 'approved') return 'default';
  if (status === 'open') return 'outline';
  return 'secondary';
}

// Clock-in/out times are BUSINESS events that become payroll — they must render
// in the organization's timezone, never the viewer's device timezone.
function formatTime(iso: string | null, timeZone: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

/** Matches the shell's own container so the strip and the totals line up. */
const CONTAINER_CLASS = 'mx-auto w-full max-w-[1079px] px-4 md:px-6';

/**
 * Timesheets, on the shared `ListPage`.
 *
 * There is no `useIsMobile` branch and no `TimesheetsMobilePage` any more: the
 * desktop table and the phone list render from the SAME column config. The
 * grouped table (a header row, a subtotal row and a grand-total row per
 * practitioner) flattens to one row per time entry with the practitioner as a
 * column; the subtotals move into the totals summary under the list, because
 * the shell renders rows, not group headers or footers.
 */
export function TimesheetsPage() {
  // Default range: current week (Mon–Sun).
  const [fromDate, setFromDate] = useState(() =>
    format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  );
  const [toDate, setToDate] = useState(() =>
    format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  );
  const [practitionerFilter, setPractitionerFilter] = useState<string>(ALL);
  const [editing, setEditing] = useState<TimeEntryWithBreaks | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // Live "now" so open-entry durations tick.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { practitioners } = useListPractitioners({});

  // Business timezone — clock-in/out times are payroll data and must not follow
  // the viewer's device timezone.
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';

  const practitionerName = useMemo(() => {
    const map = new Map(practitioners.map((p) => [p.id, p.name]));
    return (id: string) => map.get(id) ?? 'Unknown';
  }, [practitioners]);

  const practitionerLocations = useMemo(() => {
    const map = new Map(practitioners.map((p) => [p.id, p.locations]));
    return (id: string) => map.get(id);
  }, [practitioners]);

  const rangeFrom = useMemo(() => startOfDay(new Date(fromDate)), [fromDate]);
  const rangeTo = useMemo(() => endOfDay(new Date(toDate)), [toDate]);

  const { timeEntries, isLoading, isError, error } = useListTimeEntries({
    from: rangeFrom,
    to: rangeTo,
    practitionerId: practitionerFilter === ALL ? undefined : practitionerFilter,
  });

  // Open entries for the strip — independent of the range/practitioner filter
  // so it always reflects who is clocked in right now. Memoize the lower bound:
  // computing `subDays(new Date(), 30)` inline mints a fresh Date every render,
  // which changes the query key each time, so the post-clock-in invalidate +
  // refetch never settles on visible data (the strip stays "No one clocked in").
  const openEntriesFrom = useMemo(() => subDays(new Date(), 30), []);
  const { timeEntries: openEntries } = useListTimeEntries({
    status: 'open',
    from: openEntriesFrom,
  });

  const { approveTimeEntry, isApproving } = useApproveTimeEntry();
  const { deleteTimeEntry, isDeleting } = useDeleteTimeEntry();
  const [deleteTarget, setDeleteTarget] = useState<TimeEntryWithBreaks | null>(
    null
  );

  const openEdit = (entry: TimeEntryWithBreaks) => {
    setEditing(entry);
    setEditOpen(true);
  };

  const handleDelete = (entry: TimeEntryWithBreaks) => setDeleteTarget(entry);

  // One row per entry, ordered by practitioner then clock-in — the grouping the
  // old table drew with subtotal rows, kept as an ordering.
  const rows = useMemo(
    () =>
      [...timeEntries].sort((a, b) => {
        const byName = practitionerName(a.practitionerId).localeCompare(
          practitionerName(b.practitionerId)
        );
        if (byName !== 0) return byName;
        return new Date(a.clockIn).getTime() - new Date(b.clockIn).getTime();
      }),
    [timeEntries, practitionerName]
  );

  // Per-practitioner subtotals + the range total. These were footer rows in the
  // table; the shell has no footer, so they render as a summary under it.
  const totals = useMemo(() => {
    const byPractitioner = new Map<string, number>();
    for (const entry of timeEntries) {
      byPractitioner.set(
        entry.practitionerId,
        (byPractitioner.get(entry.practitionerId) ?? 0) +
          msToHours(workedMs(entry, now))
      );
    }
    const perPractitioner = Array.from(byPractitioner.entries())
      .map(([practitionerId, workedHours]) => ({
        practitionerId,
        name: practitionerName(practitionerId),
        workedHours,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return {
      perPractitioner,
      grandTotalHours: perPractitioner.reduce(
        (sum, group) => sum + group.workedHours,
        0
      ),
    };
  }, [timeEntries, practitionerName, now]);

  const columns: ListColumn<TimeEntryWithBreaks>[] = [
    {
      id: 'practitioner',
      header: 'Practitioner',
      mobile: 'primary',
      // PLAIN TEXT, not a menu trigger.
      //
      // `MobileList` makes the whole row a <button> when `onRowClick` is set,
      // so a cell that renders its own button nests one interactive element
      // inside another — invalid HTML, and the tap lands on the inner control.
      // On a phone the row IS the affordance, so the member menu here
      // swallowed it: tapping a timesheet row opened the team-member menu
      // instead of the edit-times dialog.
      //
      // The shell already states this rule for `rowActions` ("a plain element,
      // NOT a <button>"); the title cell was breaking the same one. The member
      // actions were not dropped — they moved into the row menu below, so they
      // are reachable at BOTH viewports and the two render from one config,
      // which is what this page's header promises.
      cell: (entry) => (
        <span className="font-medium">
          {practitionerName(entry.practitionerId)}
        </span>
      ),
    },
    {
      id: 'date',
      header: 'Date',
      mobile: 'secondary',
      cell: (entry) => format(zonedEvent(entry.clockIn, timeZone), 'EEE d MMM'),
    },
    {
      id: 'clockIn',
      header: 'Clock in',
      cell: (entry) => formatTime(entry.clockIn, timeZone),
    },
    {
      id: 'clockOut',
      header: 'Clock out',
      cell: (entry) => formatTime(entry.clockOut, timeZone),
    },
    {
      id: 'breaks',
      header: 'Breaks',
      cell: (entry) => {
        const breaks = totalBreakMs(entry, now);
        return breaks > 0 ? formatDurationMs(breaks) : '—';
      },
    },
    {
      id: 'worked',
      header: 'Worked',
      mobile: 'trailing',
      cell: (entry) => (
        <span className="tabular-nums">
          {formatDurationMs(workedMs(entry, now))}
        </span>
      ),
    },
    {
      id: 'source',
      header: 'Source',
      cell: (entry) => (
        <Badge variant={entry.source === 'auto' ? 'secondary' : 'outline'}>
          {timeEntrySourceLabels[entry.source]}
        </Badge>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: (entry) => (
        <Badge variant={statusVariant(entry.status)}>
          {timeEntryStatusLabels[entry.status]}
        </Badge>
      ),
    },
  ];

  return (
    <>
      <title>Timesheets | Borradh</title>

      <ListPage<TimeEntryWithBreaks>
        config={{
          title: 'Timesheets',
          // Who is on the clock right now belongs with the page header, not
          // floating above it.
          banner: (
            <ClockedInStrip
              openEntries={openEntries}
              practitionerName={practitionerName}
              practitioners={practitioners}
            />
          ),
          columns,
          rows,
          rowKey: (entry) => entry.id,
          // E2E fixtures address rows by this id on BOTH viewports; the deleted
          // hand-written mobile list emitted it and the shared list must too.
          rowTestId: (entry) => `time-entry-row-${entry.id}`,
          onRowClick: openEdit,
          rowActions: (entry) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="size-7" size="icon" variant="ghost">
                  <span className="sr-only">Open menu</span>
                  <MoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openEdit(entry)}>
                  Edit times
                </DropdownMenuItem>
                {/*
                  The team-member actions that used to hang off the
                  practitioner name. Nested here so they survive the title
                  becoming plain text, and so a phone can reach them at all.
                */}
                <TeamMemberMenu
                  locations={practitionerLocations(entry.practitionerId)}
                  practitionerId={entry.practitionerId}
                  practitionerName={practitionerName(entry.practitionerId)}
                >
                  <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                    <UserRound className="size-4" />
                    Team member…
                  </DropdownMenuItem>
                </TeamMemberMenu>
                <DropdownMenuItem
                  disabled={entry.status !== 'completed' || isApproving}
                  onClick={() => approveTimeEntry(entry.id)}
                >
                  <CheckCheck className="size-4" />
                  Approve
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => handleDelete(entry)}
                  variant="destructive"
                >
                  <Trash2 className="size-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ),
          toolbar: (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="from-date">From</Label>
                <DatePicker
                  calendarDisabled={
                    toDate
                      ? { after: parse(toDate, 'yyyy-MM-dd', new Date()) }
                      : undefined
                  }
                  className="w-40"
                  id="from-date"
                  onChange={(date) =>
                    setFromDate(date ? format(date, 'yyyy-MM-dd') : '')
                  }
                  placeholder="Select date"
                  value={
                    fromDate
                      ? parse(fromDate, 'yyyy-MM-dd', new Date())
                      : undefined
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="to-date">To</Label>
                <DatePicker
                  calendarDisabled={
                    fromDate
                      ? { before: parse(fromDate, 'yyyy-MM-dd', new Date()) }
                      : undefined
                  }
                  className="w-40"
                  id="to-date"
                  onChange={(date) =>
                    setToDate(date ? format(date, 'yyyy-MM-dd') : '')
                  }
                  placeholder="Select date"
                  value={
                    toDate ? parse(toDate, 'yyyy-MM-dd', new Date()) : undefined
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>Practitioner</Label>
                <Select
                  onValueChange={setPractitionerFilter}
                  value={practitionerFilter}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="All practitioners" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>All practitioners</SelectItem>
                    {practitioners.map((p: PractitionerWithRelations) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ),
          isLoading,
          isError,
          errorMessage: `Failed to load timesheets: ${error?.message || 'Unknown error'}`,
          empty: {
            icon: Clock,
            title: 'No time entries',
            description: 'No clock-ins recorded for the selected range.',
          },
        }}
      />

      {rows.length > 0 && (
        <div className={`${CONTAINER_CLASS} pb-6`}>
          <dl className="flex flex-col gap-1 text-sm">
            {totals.perPractitioner.map((group) => (
              <div
                className="flex justify-between text-muted-foreground"
                key={group.practitionerId}
              >
                <dt>{group.name} — subtotal</dt>
                <dd className="tabular-nums">
                  {formatHours(group.workedHours)} h
                </dd>
              </div>
            ))}
            <div className="flex justify-between border-t pt-1 font-semibold">
              <dt>Total worked (range)</dt>
              <dd className="tabular-nums">
                {formatHours(totals.grandTotalHours)} h
              </dd>
            </div>
          </dl>
        </div>
      )}

      {/*
        Pay-run / overtime pay is intentionally NOT rendered here: there is no
        pay-run endpoint in the contract. Wage configs (§1.1.8) feed a future
        pay-run surface. Seam: the per-practitioner `workedHours` totals above
        are exactly what such a view would consume, plus wage-config rates.
      */}

      <EditTimeEntryDialog
        entry={editing}
        onOpenChange={setEditOpen}
        open={editOpen}
      />

      <ConfirmDeleteDialog
        description="The clock-in, clock-out and any breaks on this entry are removed from the timesheet. This can’t be undone."
        isPending={isDeleting}
        onConfirm={() => {
          if (deleteTarget) deleteTimeEntry(deleteTarget.id);
          setDeleteTarget(null);
        }}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        open={deleteTarget !== null}
        title={
          <>
            Delete this time entry for{' '}
            {deleteTarget ? practitionerName(deleteTarget.practitionerId) : ''}?
          </>
        }
      />
    </>
  );
}
