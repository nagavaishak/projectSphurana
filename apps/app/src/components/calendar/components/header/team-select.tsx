import { format } from 'date-fns';
import { CalendarClock, ChevronDown, Users } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';

import { useCalendar } from '@/components/calendar/contexts/calendar-context';

/**
 * Multi-select team-member combobox (Fresha-style). Presets at the top
 * ("Scheduled team" = members with a shift today, "All team") switch the
 * whole selection; the checkbox list below toggles individual members.
 * Writes the calendar's `selectedUserIds` set which drives the visible
 * day-view columns and event filtering.
 */
export function TeamSelect() {
  const {
    config,
    users,
    selectedUserIds,
    setSelectedUserIds,
    resolvedShifts,
    selectedDate,
  } = useCalendar();
  const [open, setOpen] = useState(false);

  // Resource labels — team members for appointments, pages for content.
  const rs = config.resourceSelect;
  const allLabel = rs?.allLabel ?? 'All team';
  const scheduledLabel = rs ? rs.scheduledLabel : 'Scheduled team';
  const searchPlaceholder = rs?.searchPlaceholder ?? 'Search';
  const countNoun = rs?.countNoun ?? 'team members';

  // Practitioners with a working shift on the selected day.
  const scheduledIds = useMemo(() => {
    const key = format(selectedDate, 'yyyy-MM-dd');
    const set = new Set(
      resolvedShifts
        .filter((s) => s.date === key && !s.isOff && s.intervals.length > 0)
        .map((s) => s.practitionerId)
    );
    return users.filter((u) => set.has(u.id)).map((u) => u.id);
  }, [resolvedShifts, selectedDate, users]);

  const allIds = useMemo(() => users.map((u) => u.id), [users]);
  const currentIds = selectedUserIds === 'all' ? allIds : selectedUserIds;
  const isAll =
    selectedUserIds === 'all' || currentIds.length === allIds.length;

  const isChecked = (id: string) =>
    selectedUserIds === 'all' || selectedUserIds.includes(id);

  const toggle = (id: string) => {
    const next = isChecked(id)
      ? currentIds.filter((x) => x !== id)
      : [...currentIds, id];
    setSelectedUserIds(next.length === allIds.length ? 'all' : next);
  };

  const toggleAll = () => setSelectedUserIds(isAll ? [] : 'all');

  const sameSet = (a: string[]) =>
    a.length === currentIds.length && a.every((id) => currentIds.includes(id));

  const triggerLabel = () => {
    if (selectedUserIds === 'all') return allLabel;
    if (currentIds.length === 0) return `No ${countNoun}`;
    if (scheduledLabel && scheduledIds.length > 0 && sameSet(scheduledIds))
      return scheduledLabel;
    if (currentIds.length === 1) {
      return users.find((u) => u.id === currentIds[0])?.name ?? '1 member';
    }
    return `${currentIds.length} ${countNoun}`;
  };
  const label = triggerLabel();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className="justify-between gap-2 font-medium"
          aria-label="Select team members"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="size-4 shrink-0 opacity-60" />
        </Button>
      </PopoverTrigger>

      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>No {countNoun} found.</CommandEmpty>

            <CommandGroup>
              {scheduledLabel && (
                <CommandItem
                  value={scheduledLabel}
                  onSelect={() => {
                    setSelectedUserIds(scheduledIds);
                    setOpen(false);
                  }}
                >
                  <CalendarClock className="size-4 text-muted-foreground" />
                  {scheduledLabel}
                </CommandItem>
              )}
              <CommandItem
                value={allLabel}
                onSelect={() => {
                  setSelectedUserIds('all');
                  setOpen(false);
                }}
              >
                <Users className="size-4 text-muted-foreground" />
                {allLabel}
              </CommandItem>
            </CommandGroup>

            <CommandSeparator />

            <CommandGroup>
              <CommandItem value={`All ${countNoun}`} onSelect={toggleAll}>
                <Checkbox checked={isAll} className="pointer-events-none" />
                All {countNoun}
              </CommandItem>

              {users.map((user) => (
                <CommandItem
                  key={user.id}
                  value={user.name}
                  onSelect={() => toggle(user.id)}
                >
                  <Checkbox
                    checked={isChecked(user.id)}
                    className="pointer-events-none"
                  />
                  <Avatar className="size-6">
                    <AvatarImage
                      src={user.picturePath ?? undefined}
                      alt={user.name}
                    />
                    <AvatarFallback className="text-xxs">
                      {user.name[0]}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{user.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
