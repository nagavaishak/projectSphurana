import { format } from 'date-fns';
import { useEffect, useState } from 'react';

import {
  useUpdateStandingOpeningHours,
  useUpsertOpeningHoursException,
} from '@/features/location-opening-hours';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';

import type { LocationOpeningHours } from '@borradh-workspace/api-client/types';

type EditScope = 'date' | 'standing';

interface EditOpeningHoursDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId: string;
  /** The date being clicked on the calendar. */
  date: Date;
  /** Effective hours for this day before edit, used to seed the form. */
  initial: { fromMinutes: number; toMinutes: number; closed: boolean };
  /** Standing weekly schedule, used when applying scope='standing'. */
  standing: LocationOpeningHours | null;
  /** Org default schedule, fallback when standing is null. */
  organizationDefault: LocationOpeningHours | null;
}

const minutesToHHMM = (m: number) => {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
};
const hhmmToMinutes = (s: string) => {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
};

export function EditOpeningHoursDialog({
  open,
  onOpenChange,
  locationId,
  date,
  initial,
  standing,
  organizationDefault,
}: EditOpeningHoursDialogProps) {
  const [scope, setScope] = useState<EditScope>('date');
  const [closed, setClosed] = useState(initial.closed);
  const [from, setFrom] = useState(minutesToHHMM(initial.fromMinutes));
  const [to, setTo] = useState(minutesToHHMM(initial.toMinutes));

  // Reset form when the dialog re-opens for a different day.
  useEffect(() => {
    if (!open) return;
    setScope('date');
    setClosed(initial.closed);
    setFrom(minutesToHHMM(initial.fromMinutes));
    setTo(minutesToHHMM(initial.toMinutes));
  }, [open, initial.fromMinutes, initial.toMinutes, initial.closed]);

  const { upsertOpeningHoursExceptionAsync, isUpserting } =
    useUpsertOpeningHoursException({ onSuccess: () => onOpenChange(false) });
  const { updateStandingOpeningHoursAsync, isUpdating } =
    useUpdateStandingOpeningHours({ onSuccess: () => onOpenChange(false) });

  const handleSave = async () => {
    const fromMinutes = closed ? null : hhmmToMinutes(from);
    const toMinutes = closed ? null : hhmmToMinutes(to);
    if (
      !closed &&
      fromMinutes !== null &&
      toMinutes !== null &&
      toMinutes <= fromMinutes
    ) {
      return; // form-level validation
    }

    if (scope === 'date') {
      await upsertOpeningHoursExceptionAsync({
        locationId,
        date: format(date, 'yyyy-MM-dd'),
        closed,
        fromMinutes,
        toMinutes,
      });
      return;
    }

    // scope === 'standing': edit the day-of-week's row in the standing
    // schedule, falling back to org default if the location had no standing
    // schedule yet.
    const dow = String(date.getDay());
    const base = standing ?? organizationDefault ?? {};
    const next: LocationOpeningHours = { ...base };
    if (closed) {
      delete next[dow];
    } else if (fromMinutes !== null && toMinutes !== null) {
      next[dow] = { from: fromMinutes, to: toMinutes };
    }
    await updateStandingOpeningHoursAsync({
      locationId,
      openingHours: Object.keys(next).length === 0 ? null : next,
    });
  };

  const isSaving = isUpserting || isUpdating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit opening hours</DialogTitle>
          <DialogDescription>
            {format(date, 'EEEE, MMMM d, yyyy')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="oh-closed"
              checked={closed}
              onCheckedChange={(v) => setClosed(v === true)}
            />
            <Label htmlFor="oh-closed" className="cursor-pointer">
              Closed all day
            </Label>
          </div>

          {!closed && (
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="oh-from">Opens</FieldLabel>
                <Input
                  id="oh-from"
                  type="time"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="oh-to">Closes</FieldLabel>
                <Input
                  id="oh-to"
                  type="time"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </Field>
            </div>
          )}

          <Field>
            <FieldLabel>Apply to</FieldLabel>
            <RadioGroup
              value={scope}
              onValueChange={(v) => setScope(v as EditScope)}
            >
              <div className="flex items-start gap-2">
                <RadioGroupItem value="date" id="scope-date" className="mt-1" />
                <Label htmlFor="scope-date" className="cursor-pointer">
                  Just this day
                  <p className="text-xs font-normal text-muted-foreground">
                    Only changes {format(date, 'EEEE, MMM d')}.
                  </p>
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <RadioGroupItem
                  value="standing"
                  id="scope-standing"
                  className="mt-1"
                />
                <Label htmlFor="scope-standing" className="cursor-pointer">
                  From now on (every {format(date, 'EEEE')})
                  <p className="text-xs font-normal text-muted-foreground">
                    Updates the standing weekly schedule.
                  </p>
                </Label>
              </div>
            </RadioGroup>
          </Field>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
