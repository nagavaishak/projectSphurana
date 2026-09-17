import { zodResolver } from '@hookform/resolvers/zod';
import { format, parse } from 'date-fns';
import { useEffect, useMemo, useRef } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useActiveOrganization } from '@/features/organization';
import { useListPractitioners } from '@/features/practitioners';
import {
  timeOffTypeLabels,
  timeOffTypeValues,
} from '@borradh-workspace/api-client/types';
import {
  type TimeOff,
  useCreateTimeOff,
  useDeleteTimeOff,
  useUpdateTimeOff,
} from '../api';
import { parseRRule } from '../lib/rrule';
import { combineDateTime, snapToFiveMinutes } from '../lib/time';
import { TimeSelect } from './time-select';

const timeOffFormSchema = z
  .object({
    practitionerId: z.string().min(1, 'Choose a team member'),
    type: z.enum(timeOffTypeValues),
    startDate: z.string().min(1, 'Start date is required'),
    startTime: z.string().min(1),
    endDate: z.string().min(1, 'End date is required'),
    endTime: z.string().min(1),
    repeats: z.boolean(),
    repeatUntil: z.string().optional(),
    description: z.string().optional(),
    approved: z.boolean(),
  })
  .superRefine((data, ctx) => {
    const start = combineDateTime(data.startDate, data.startTime);
    const end = combineDateTime(data.endDate, data.endTime);
    if (end <= start) {
      ctx.addIssue({
        code: 'custom',
        message: 'End must be after start',
        path: ['endTime'],
      });
    }
    if (data.repeats && !data.repeatUntil) {
      ctx.addIssue({
        code: 'custom',
        message: 'Choose a repeat-until date',
        path: ['repeatUntil'],
      });
    }
  });

type FormData = z.infer<typeof timeOffFormSchema>;

interface TimeOffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this time off entry. */
  timeOff?: TimeOff | null;
  /** Prefill for create mode. */
  initial?: { practitionerId?: string; date?: string };
}

/**
 * Create/edit dialog for team member time off: type, start/end (5-minute
 * increments), weekly repeat until a date (stored as an RRULE), description,
 * approved toggle and a computed "Time off total" footer.
 */
export function TimeOffDialog({
  open,
  onOpenChange,
  timeOff,
  initial,
}: TimeOffDialogProps) {
  const isEditing = !!timeOff;
  const { practitioners } = useListPractitioners({
    params: { isActive: true },
  });
  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';

  const defaultValues = useMemo<FormData>(() => {
    if (timeOff) {
      const start = new Date(timeOff.startDate);
      const end = new Date(timeOff.endDate);
      const parsed = timeOff.rrule ? parseRRule(timeOff.rrule) : null;
      return {
        practitionerId: timeOff.practitionerId,
        type: timeOff.type,
        startDate: format(start, 'yyyy-MM-dd'),
        startTime: snapToFiveMinutes(format(start, 'HH:mm')),
        endDate: format(end, 'yyyy-MM-dd'),
        endTime: snapToFiveMinutes(format(end, 'HH:mm')),
        repeats: !!timeOff.rrule,
        repeatUntil: parsed?.until
          ? format(parsed.until, 'yyyy-MM-dd')
          : timeOff.recurrenceEndDate
            ? format(new Date(timeOff.recurrenceEndDate), 'yyyy-MM-dd')
            : undefined,
        description: timeOff.description ?? '',
        approved: timeOff.approved,
      };
    }
    const date = initial?.date ?? format(new Date(), 'yyyy-MM-dd');
    return {
      practitionerId: initial?.practitionerId ?? '',
      type: 'annual_leave',
      startDate: date,
      startTime: '09:00',
      endDate: date,
      endTime: '17:00',
      repeats: false,
      repeatUntil: undefined,
      description: '',
      approved: true,
    };
  }, [timeOff, initial]);

  const form = useForm<FormData>({
    resolver: zodResolver(timeOffFormSchema),
    defaultValues,
  });

  // Re-seed on the OPEN TRANSITION only.
  //
  // `defaultValues` is a `useMemo` over props, so leaving it to drive this
  // effect meant any parent re-render reset the form WHILE IT WAS OPEN and
  // discarded whatever had been typed. Observed by hand in this dialog: a name
  // entered then lost, and a Location picked then reverted to "All locations".
  // `hasSeeded` makes it fire on false→true only.
  const hasSeeded = useRef(false);
  useEffect(() => {
    if (open && !hasSeeded.current) {
      form.reset(defaultValues);
      hasSeeded.current = true;
    } else if (!open) {
      hasSeeded.current = false;
    }
  }, [open, defaultValues, form]);

  const { createTimeOff, isCreating } = useCreateTimeOff({
    onSuccess: () => onOpenChange(false),
  });
  const { updateTimeOff, isUpdating } = useUpdateTimeOff({
    onSuccess: () => onOpenChange(false),
  });
  const { deleteTimeOff, isDeleting } = useDeleteTimeOff({
    onSuccess: () => onOpenChange(false),
  });

  const repeats = form.watch('repeats');
  const watched = form.watch(['startDate', 'startTime', 'endDate', 'endTime']);

  const totalHours = useMemo(() => {
    const [startDate, startTime, endDate, endTime] = watched;
    if (!(startDate && endDate)) return null;
    const start = combineDateTime(startDate, startTime || '00:00');
    const end = combineDateTime(endDate, endTime || '00:00');
    const hours = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
    if (!Number.isFinite(hours) || hours <= 0) return null;
    return Math.round(hours * 10) / 10;
  }, [watched]);

  const handleSubmit = (data: FormData) => {
    // The component passes typed INTENT (form values + business timezone); the
    // mutation hooks own the wire-body assembly. Wall-clock times resolve in the
    // ORG timezone, never the device's.
    if (isEditing && timeOff) {
      updateTimeOff({ id: timeOff.id, timeZone, ...data });
    } else {
      createTimeOff({ timeZone, ...data });
    }
  };

  const isSaving = isCreating || isUpdating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit time off' : 'Add time off'}
          </DialogTitle>
          <DialogDescription>
            Time off removes the team member from the bookable schedule.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-4"
          id="time-off-form"
        >
          <div className="grid grid-cols-2 gap-3">
            <Controller
              name="practitionerId"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Team member</FieldLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={isEditing}
                  >
                    <SelectTrigger
                      id={field.name}
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue placeholder="Select team member" />
                    </SelectTrigger>
                    <SelectContent>
                      {practitioners.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {fieldState.error && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            <Controller
              name="type"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Type</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={field.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {timeOffTypeValues.map((value) => (
                        <SelectItem key={value} value={value}>
                          {timeOffTypeLabels[value]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Controller
              name="startDate"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Start date</FieldLabel>
                  <DatePicker
                    id={field.name}
                    placeholder="Select date"
                    value={
                      field.value
                        ? parse(field.value, 'yyyy-MM-dd', new Date())
                        : undefined
                    }
                    onChange={(date) =>
                      field.onChange(date ? format(date, 'yyyy-MM-dd') : '')
                    }
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.error && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              name="startTime"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Start time</FieldLabel>
                  <TimeSelect
                    id={field.name}
                    value={field.value}
                    onChange={field.onChange}
                  />
                </Field>
              )}
            />
            <Controller
              name="endDate"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>End date</FieldLabel>
                  <DatePicker
                    id={field.name}
                    placeholder="Select date"
                    value={
                      field.value
                        ? parse(field.value, 'yyyy-MM-dd', new Date())
                        : undefined
                    }
                    onChange={(date) =>
                      field.onChange(date ? format(date, 'yyyy-MM-dd') : '')
                    }
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.error && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
            <Controller
              name="endTime"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>End time</FieldLabel>
                  <TimeSelect
                    id={field.name}
                    value={field.value}
                    onChange={field.onChange}
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.error && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          </div>

          <Controller
            name="repeats"
            control={form.control}
            render={({ field }) => (
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="time-off-repeats" className="cursor-pointer">
                  Repeats weekly
                </Label>
                <Switch
                  id="time-off-repeats"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </div>
            )}
          />

          {repeats && (
            <Controller
              name="repeatUntil"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Repeat until</FieldLabel>
                  <DatePicker
                    id={field.name}
                    placeholder="Select date"
                    value={
                      field.value
                        ? parse(field.value, 'yyyy-MM-dd', new Date())
                        : undefined
                    }
                    onChange={(date) =>
                      field.onChange(
                        date ? format(date, 'yyyy-MM-dd') : undefined
                      )
                    }
                    aria-invalid={fieldState.invalid}
                  />
                  {fieldState.error && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />
          )}

          <Controller
            name="description"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor={field.name}>Description</FieldLabel>
                <Textarea
                  {...field}
                  id={field.name}
                  placeholder="Optional notes"
                  rows={2}
                />
              </Field>
            )}
          />

          <Controller
            name="approved"
            control={form.control}
            render={({ field }) => (
              <div className="flex items-center justify-between rounded-md border p-3">
                <Label htmlFor="time-off-approved" className="cursor-pointer">
                  Approved
                </Label>
                <Switch
                  id="time-off-approved"
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </div>
            )}
          />
        </form>

        <div className="border-t pt-3 text-sm text-muted-foreground">
          Time off total:{' '}
          <span className="font-medium text-foreground">
            {totalHours !== null ? `${totalHours} hours` : '—'}
          </span>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {isEditing && timeOff ? (
            <Button
              type="button"
              variant="destructive"
              disabled={isDeleting}
              onClick={() => deleteTimeOff(timeOff.id)}
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" form="time-off-form" disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
