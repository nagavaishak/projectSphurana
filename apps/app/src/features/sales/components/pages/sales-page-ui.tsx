/**
 * Shared presentational primitives for the Sales section pages, styled to
 * match the Fresha reference: a title + subtitle header with right-aligned
 * actions, a grey rounded filter toolbar with a pill search, tone-coloured
 * status badges, and a centered "Showing X of Y results" footer.
 */
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfMonth,
  startOfToday,
  startOfWeek,
} from 'date-fns';
import { CalendarDays, ChevronDown, ListFilter, Search } from 'lucide-react';
import type * as React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type {
  AppointmentStatus,
  SalePaymentStatus,
  SaleStatus,
} from '@borradh-workspace/api-client/types';

// ---------------------------------------------------------------------------
// Page header
// ---------------------------------------------------------------------------

interface SalesPageHeaderProps {
  title: string;
  description?: React.ReactNode;
  /** Right-aligned actions (Export / Options / Add new …). */
  actions?: React.ReactNode;
  /** Small count chip rendered next to the title (e.g. Product orders "0"). */
  count?: React.ReactNode;
}

export function SalesPageHeader({
  title,
  description,
  actions,
  count,
}: SalesPageHeaderProps) {
  return (
    <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
      <div className="space-y-1">
        <div className="flex items-center gap-2.5">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {title}
          </h1>
          {count != null && (
            <span className="inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-sm font-medium text-muted-foreground">
              {count}
            </span>
          )}
        </div>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-shrink-0 items-center gap-2">{actions}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filter toolbar
// ---------------------------------------------------------------------------

export function SalesToolbar({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl bg-muted/50 p-3 sm:flex-row sm:items-center',
        className
      )}
    >
      {children}
    </div>
  );
}

export function ToolbarSearch({
  value,
  onChange,
  placeholder = 'Search',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn('relative w-full sm:max-w-sm', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 rounded-full border-transparent bg-background pl-9 shadow-sm"
      />
    </div>
  );
}

/** Pill-shaped outline button used for the date / Filters / sort controls. */
export function ToolbarButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn('h-11 rounded-full bg-background', className)}
      {...props}
    />
  );
}

/**
 * Export / Options dropdown for a page header. Renders a pill trigger with a
 * single "Export as CSV" action wired to `onExportCsv`. When no rows exist the
 * action is disabled.
 */
export function ExportMenu({
  label = 'Export',
  onExportCsv,
  disabled,
}: {
  label?: string;
  onExportCsv: () => void;
  disabled?: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="rounded-full">
          {label}
          <ChevronDown className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={disabled} onSelect={onExportCsv}>
          Export as CSV
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Escape + join a table into a CSV blob and trigger a browser download. */
export function downloadCsv(
  filename: string,
  headers: string[],
  rows: (string | number)[][]
): void {
  const escapeCell = (v: string | number) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCell).join(','))
    .join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Date preset filter
// ---------------------------------------------------------------------------

export type DatePreset = 'today' | 'week' | 'month' | 'all';

export const datePresetLabels: Record<DatePreset, string> = {
  today: 'Today',
  week: 'This week',
  month: 'Month to date',
  all: 'All time',
};

/** Resolve a preset to an inclusive ISO date range (undefined = unbounded). */
export function datePresetRange(preset: DatePreset): {
  from?: string;
  to?: string;
} {
  const now = startOfToday();
  switch (preset) {
    case 'today':
      return { from: now.toISOString(), to: endOfDay(now).toISOString() };
    case 'week':
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }).toISOString(),
        to: endOfWeek(now, { weekStartsOn: 1 }).toISOString(),
      };
    case 'month':
      return {
        from: startOfMonth(now).toISOString(),
        to: endOfMonth(now).toISOString(),
      };
    default:
      return {};
  }
}

export function DatePresetMenu({
  value,
  onChange,
}: {
  value: DatePreset;
  onChange: (value: DatePreset) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ToolbarButton>
          <CalendarDays className="size-4" />
          {datePresetLabels[value]}
        </ToolbarButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(v) => onChange(v as DatePreset)}
        >
          {(Object.keys(datePresetLabels) as DatePreset[]).map((preset) => (
            <DropdownMenuRadioItem key={preset} value={preset}>
              {datePresetLabels[preset]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Non-functional visual "Filters" pill matching the Fresha toolbar. */
export function FiltersButton(props: React.ComponentProps<typeof Button>) {
  return (
    <ToolbarButton {...props}>
      <ListFilter className="size-4" />
      Filters
    </ToolbarButton>
  );
}

// ---------------------------------------------------------------------------
// Results footer
// ---------------------------------------------------------------------------

export function ResultsFooter({
  shown,
  total,
  noun = 'results',
}: {
  shown: number;
  total: number;
  noun?: string;
}) {
  return (
    <p className="text-center text-sm text-muted-foreground">
      Showing {shown} of {total} {noun}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Status badges
// ---------------------------------------------------------------------------

type Tone = 'blue' | 'green' | 'grey' | 'amber' | 'red' | 'violet';

const toneClasses: Record<Tone, string> = {
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
  grey: 'bg-muted text-muted-foreground',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  violet:
    'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
};

export function StatusBadge({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <Badge className={cn('border-transparent font-medium', toneClasses[tone])}>
      {children}
    </Badge>
  );
}

export const saleStatusTone: Record<SaleStatus, Tone> = {
  open: 'blue',
  completed: 'green',
  refunded: 'amber',
  partially_refunded: 'amber',
  voided: 'red',
};

export const appointmentStatusTone: Record<AppointmentStatus, Tone> = {
  booked: 'blue',
  confirmed: 'blue',
  arrived: 'violet',
  started: 'amber',
  completed: 'grey',
  no_show: 'red',
  cancelled: 'red',
  // Amber, not blue: a hold is provisional and releases itself if never
  // confirmed, so it must not read as a settled booking at a glance.
  held: 'amber',
};

export const paymentStatusTone: Record<SalePaymentStatus, Tone> = {
  pending: 'amber',
  succeeded: 'green',
  failed: 'red',
  refunded: 'grey',
};

// ---------------------------------------------------------------------------
// Reference numbers
// ---------------------------------------------------------------------------

/**
 * Derive a stable, Fresha-style short reference (e.g. `EE13BD30`) from an
 * entity id. The ids are cuids with no human-facing sequence, so we hash them
 * to 8 hex digits — deterministic per record and stable across renders.
 */
export function shortRef(id: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}
