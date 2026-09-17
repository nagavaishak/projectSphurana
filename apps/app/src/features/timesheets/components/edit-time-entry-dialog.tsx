import type { TimeEntryWithBreaks } from '@borradh-workspace/api-client/types';
import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useUpdateTimeEntry } from '../api';

/** ISO string → `YYYY-MM-DDTHH:mm` in the viewer's local timezone. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** Local datetime-local value → ISO string (or null when empty). */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

interface EditTimeEntryDialogProps {
  entry: TimeEntryWithBreaks | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditTimeEntryDialog({
  entry,
  open,
  onOpenChange,
}: EditTimeEntryDialogProps) {
  const [clockIn, setClockIn] = useState('');
  const [clockOut, setClockOut] = useState('');

  const { updateTimeEntry, isUpdating } = useUpdateTimeEntry({
    onSuccess: () => onOpenChange(false),
  });

  useEffect(() => {
    if (entry) {
      setClockIn(isoToLocalInput(entry.clockIn));
      setClockOut(isoToLocalInput(entry.clockOut));
    }
  }, [entry]);

  // Approved entries are locked server-side (see update-time-entry.service).
  const isLocked = entry?.status === 'approved';

  const handleSubmit = () => {
    if (!entry || isLocked) return;
    const clockInIso = localInputToIso(clockIn);
    if (!clockInIso) return; // clock-in is required
    updateTimeEntry({
      id: entry.id,
      clockIn: clockInIso,
      // null re-opens the entry (status → open); undefined leaves it untouched
      clockOut: clockOut ? localInputToIso(clockOut) : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit time entry</DialogTitle>
          <DialogDescription>
            Adjust the clock-in and clock-out times. Clearing clock-out re-opens
            the entry.
          </DialogDescription>
        </DialogHeader>

        {isLocked ? (
          <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-400">
            <Lock className="size-4 shrink-0" />
            <span>
              This entry has been approved and can no longer be edited.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="clock-in">Clock in</Label>
              <Input
                id="clock-in"
                type="datetime-local"
                value={clockIn}
                onChange={(e) => setClockIn(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="clock-out">Clock out</Label>
              <Input
                id="clock-out"
                type="datetime-local"
                value={clockOut}
                onChange={(e) => setClockOut(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Leave empty to mark the practitioner as still clocked in.
              </p>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {isLocked ? 'Close' : 'Cancel'}
          </Button>
          {!isLocked && (
            <Button onClick={handleSubmit} disabled={isUpdating || !clockIn}>
              {isUpdating ? 'Saving…' : 'Save changes'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
