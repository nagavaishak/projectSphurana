import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useCreateBlockedTimeType, useUpdateBlockedTimeType } from '../api';
import type { BlockedTimeType } from '../api';
import { DURATION_OPTIONS } from '../lib/time';

const blockedTimeTypeFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  durationMinutes: z.number().int().multipleOf(5).min(5).max(535),
  paid: z.enum(['paid', 'unpaid']),
});

type FormData = z.infer<typeof blockedTimeTypeFormSchema>;

interface BlockedTimeTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this type; otherwise it creates a new one. */
  blockedTimeType?: BlockedTimeType | null;
}

/**
 * Create/edit dialog for blocked time types (Settings → Blocked time types):
 * name, default duration in 5-minute increments up to 8h55, paid/unpaid.
 */
export function BlockedTimeTypeDialog({
  open,
  onOpenChange,
  blockedTimeType,
}: BlockedTimeTypeDialogProps) {
  const isEditing = !!blockedTimeType;

  const form = useForm<FormData>({
    resolver: zodResolver(blockedTimeTypeFormSchema),
    defaultValues: {
      name: '',
      durationMinutes: 60,
      paid: 'unpaid',
    },
  });

  useEffect(() => {
    if (open) {
      form.reset({
        name: blockedTimeType?.name ?? '',
        durationMinutes: blockedTimeType?.durationMinutes ?? 60,
        paid: blockedTimeType?.paid ? 'paid' : 'unpaid',
      });
    }
  }, [open, blockedTimeType, form]);

  const { createBlockedTimeType, isCreating } = useCreateBlockedTimeType({
    onSuccess: () => onOpenChange(false),
  });
  const { updateBlockedTimeType, isUpdating } = useUpdateBlockedTimeType({
    onSuccess: () => onOpenChange(false),
  });

  const handleSubmit = (data: FormData) => {
    // The component passes typed INTENT (form values, `paid` as a radio); the
    // mutation hooks own the wire-body assembly (radio → boolean).
    if (isEditing && blockedTimeType) {
      updateBlockedTimeType({ id: blockedTimeType.id, ...data });
    } else {
      createBlockedTimeType(data);
    }
  };

  const isSaving = isCreating || isUpdating;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? 'Edit blocked time type' : 'New blocked time type'}
          </DialogTitle>
          <DialogDescription>
            Reusable presets for blocking time on the calendar, e.g. lunch or
            training.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={form.handleSubmit(handleSubmit)}
          className="space-y-4"
          id="blocked-time-type-form"
        >
          <Controller
            name="name"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name}>Name</FieldLabel>
                <Input
                  {...field}
                  id={field.name}
                  placeholder="e.g. Lunch"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.error && <FieldError errors={[fieldState.error]} />}
              </Field>
            )}
          />

          <div className="grid grid-cols-2 gap-4">
            <Controller
              name="durationMinutes"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>Duration</FieldLabel>
                  <Select
                    value={String(field.value)}
                    onValueChange={(v) => field.onChange(Number(v))}
                  >
                    <SelectTrigger
                      id={field.name}
                      aria-invalid={fieldState.invalid}
                    >
                      <SelectValue placeholder="Select duration" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {DURATION_OPTIONS.map((option) => (
                        <SelectItem
                          key={option.value}
                          value={String(option.value)}
                        >
                          {option.label}
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
              name="paid"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>Compensation</FieldLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id={field.name}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unpaid">Unpaid</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="blocked-time-type-form"
            disabled={isSaving}
          >
            {isSaving ? 'Saving...' : isEditing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
