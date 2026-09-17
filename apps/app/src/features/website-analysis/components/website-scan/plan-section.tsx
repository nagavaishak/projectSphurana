import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';

/** One tickable row of the plan. */
export interface PlanRowSpec {
  key: string;
  content: React.ReactNode;
}

/**
 * A run of rows that share a decision. A section has one group of additions
 * and, when the account holds rows the site no longer lists, a second group of
 * switch-offs — kept apart so the lossy choice is never a stray tick in the
 * middle of a list of harmless ones.
 */
export interface PlanGroupSpec {
  rows: PlanRowSpec[];
  /** Heading for a group that needs one; the additions group needs none. */
  label?: string;
  hint?: string;
  /** Switch-off groups render muted and stay collapsed until asked for. */
  tone?: 'default' | 'destructive';
}

/** Rows past this many are folded away — a real site yields ~60 services. */
const COLLAPSE_AFTER = 6;

function PlanGroup({
  group,
  selected,
  onToggleMany,
  onToggle,
}: {
  group: PlanGroupSpec;
  selected: ReadonlySet<string>;
  onToggle: (key: string, checked: boolean) => void;
  onToggleMany: (keys: string[], checked: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const keys = group.rows.map((r) => r.key);
  const selectedHere = keys.filter((k) => selected.has(k)).length;
  const hidden = Math.max(0, group.rows.length - COLLAPSE_AFTER);
  const visible = expanded ? group.rows : group.rows.slice(0, COLLAPSE_AFTER);

  return (
    <div className="space-y-2">
      {group.label ? (
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p
            className={cn(
              'font-medium text-xs',
              group.tone === 'destructive'
                ? 'text-amber-700 dark:text-amber-500'
                : 'text-muted-foreground'
            )}
          >
            {group.label}
          </p>
          {group.hint ? (
            <p className="text-muted-foreground text-xs">{group.hint}</p>
          ) : null}
        </div>
      ) : null}

      <ul className="space-y-1">
        {visible.map((row) => (
          <li key={row.key}>
            <label
              className="flex cursor-pointer items-start gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
              htmlFor={`row-${row.key}`}
            >
              <Checkbox
                checked={selected.has(row.key)}
                className="mt-0.5"
                id={`row-${row.key}`}
                onCheckedChange={(checked) =>
                  onToggle(row.key, checked === true)
                }
              />
              <span className="min-w-0 text-sm">{row.content}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-1 pl-2">
        {hidden > 0 && !expanded ? (
          <Button
            className="h-7 px-2 text-xs"
            onClick={() => setExpanded(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <ChevronDownIcon />
            Show {hidden} more
          </Button>
        ) : null}
        {group.rows.length > 1 ? (
          <Button
            className="h-7 px-2 text-muted-foreground text-xs"
            onClick={() => onToggleMany(keys, selectedHere < group.rows.length)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {selectedHere < group.rows.length
              ? `Select all ${group.rows.length}`
              : 'Clear all'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One reviewable section of the plan — "Services & prices", "Team members".
 *
 * Every actionable row is a checkbox, so there is no separate mode control to
 * reconcile with the list: what is ticked is what happens.
 */
export function PlanSection({
  title,
  groups,
  notes,
  emptyLabel,
  selected,
  onToggle,
  onToggleMany,
}: {
  title: string;
  groups: PlanGroupSpec[];
  /** Things the scan found but cannot act on, with the reason. */
  notes?: { name: string; reason: string }[];
  emptyLabel?: string;
  selected: ReadonlySet<string>;
  onToggle: (key: string, checked: boolean) => void;
  onToggleMany: (keys: string[], checked: boolean) => void;
}) {
  const populated = groups.filter((g) => g.rows.length > 0);
  const total = populated.reduce((n, g) => n + g.rows.length, 0);
  const chosen = populated.reduce(
    (n, g) => n + g.rows.filter((r) => selected.has(r.key)).length,
    0
  );

  if (total === 0 && !notes?.length) {
    return emptyLabel ? (
      <section className="space-y-1">
        <h3 className="font-medium text-sm">{title}</h3>
        <p className="text-muted-foreground text-sm">{emptyLabel}</p>
      </section>
    ) : null;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-medium text-sm">{title}</h3>
        {total > 0 ? (
          <p className="text-muted-foreground text-xs tabular-nums">
            {chosen} of {total} selected
          </p>
        ) : null}
      </div>

      {populated.map((group) => (
        <PlanGroup
          group={group}
          key={group.label ?? 'additions'}
          onToggle={onToggle}
          onToggleMany={onToggleMany}
          selected={selected}
        />
      ))}

      {notes?.length ? (
        <ul className="space-y-1 pl-2">
          {notes.map((note) => (
            <li className="text-muted-foreground text-xs" key={note.name}>
              Skipping <span className="font-medium">{note.name}</span> —{' '}
              {note.reason}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
