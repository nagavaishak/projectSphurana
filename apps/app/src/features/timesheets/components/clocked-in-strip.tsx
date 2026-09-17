import type {
  PractitionerWithRelations,
  TimeEntryWithBreaks,
} from '@borradh-workspace/api-client/types';
import { Clock, Coffee, LogIn, LogOut, Play } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useActiveOrganization } from '@/features/organization';
import { useAddBreak, useClockIn, useClockOut } from '../api';

// "since HH:MM" is a clock-in — a business event feeding payroll — so it renders
// in the organization's timezone, not the viewer's device timezone.
function formatSince(iso: string, timeZone: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
}

interface ClockedInStripProps {
  openEntries: TimeEntryWithBreaks[];
  practitioners: PractitionerWithRelations[];
  practitionerName: (id: string) => string;
}

/**
 * Compact "who's clocked in now" strip plus a control to clock a
 * currently-off practitioner in.
 */
export function ClockedInStrip({
  openEntries,
  practitioners,
  practitionerName,
}: ClockedInStripProps) {
  const { clockIn, isClockingIn } = useClockIn();
  const { clockOut, isClockingOut } = useClockOut();
  const { addBreak, isAddingBreak } = useAddBreak();
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';
  const [selectedPractitioner, setSelectedPractitioner] = useState<string>('');

  const clockedInIds = useMemo(
    () => new Set(openEntries.map((e) => e.practitionerId)),
    [openEntries]
  );

  // Only active practitioners who are not already clocked in can clock in.
  const clockableIn = useMemo(
    () => practitioners.filter((p) => p.isActive && !clockedInIds.has(p.id)),
    [practitioners, clockedInIds]
  );

  const handleClockIn = () => {
    if (!selectedPractitioner) return;
    clockIn(
      { practitionerId: selectedPractitioner },
      { onSuccess: () => setSelectedPractitioner('') }
    );
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Clock className="size-4 text-muted-foreground" />
          Clocked in now
          <span className="text-muted-foreground">({openEntries.length})</span>
        </div>

        {openEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No one is currently clocked in.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {openEntries.map((entry) => {
              const onBreak = (entry.breaks ?? []).some((b) => !b.breakEnd);
              return (
                <div
                  key={entry.id}
                  className="flex max-w-full flex-wrap items-center gap-3 rounded-3xl border bg-muted/40 py-1 pl-3 pr-1 text-sm sm:flex-nowrap sm:rounded-full"
                >
                  <span
                    className={`inline-block size-2 rounded-full ${
                      onBreak ? 'bg-amber-500' : 'bg-green-500'
                    }`}
                  />
                  <span className="font-medium">
                    {practitionerName(entry.practitionerId)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {onBreak
                      ? 'on break'
                      : `since ${formatSince(entry.clockIn, timeZone)}`}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 rounded-full px-2"
                    disabled={isAddingBreak}
                    onClick={() =>
                      addBreak({
                        id: entry.id,
                        type: onBreak ? 'end' : 'start',
                      })
                    }
                  >
                    {onBreak ? (
                      <>
                        <Play className="size-3.5" />
                        End break
                      </>
                    ) : (
                      <>
                        <Coffee className="size-3.5" />
                        Start break
                      </>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 rounded-full px-2"
                    disabled={isClockingOut}
                    onClick={() => clockOut({ id: entry.id })}
                  >
                    <LogOut className="size-3.5" />
                    Clock out
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {clockableIn.length > 0 && (
          <div className="flex items-center gap-2">
            <Select
              value={selectedPractitioner}
              onValueChange={setSelectedPractitioner}
            >
              <SelectTrigger
                className="h-9 w-56"
                aria-label="Clock in a practitioner"
              >
                <SelectValue placeholder="Clock in a practitioner…" />
              </SelectTrigger>
              <SelectContent>
                {clockableIn.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              className="gap-1.5"
              disabled={!selectedPractitioner || isClockingIn}
              onClick={handleClockIn}
            >
              <LogIn className="size-4" />
              Clock in
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
