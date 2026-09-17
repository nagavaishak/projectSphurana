import { format, parse } from 'date-fns';
import { type Control, Controller } from 'react-hook-form';

import { DatePicker } from '@/components/ui/date-picker';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

import {
  type AppointmentEditFormData,
  type AppointmentEditStaff,
  appointmentDurationOptions,
  appointmentEditForm,
} from './appointment-edit-form';

/**
 * SHARED FIELDS — the desktop edit dialog and the mobile booking sheet compose
 * these, bound to the shared `appointmentEditForm`. Labels are rendered from the
 * declaration (`L.x`), never as literals: the form contract locates each control
 * by that same string, so a control deleted from one surface (which is how the
 * mobile sheet lost Title and Duration) fails the contract instead of silently
 * shipping.
 */
const L = appointmentEditForm.labels;

interface AppointmentEditFieldsProps {
  control: Control<AppointmentEditFormData>;
  /** Staff options, keyed by PRACTITIONER id (see appointmentEditStaffOptions). */
  staff: AppointmentEditStaff[];
  /** The booking's current length — always one of the duration options. */
  currentDurationMinutes: number;
  className?: string;
}

export function AppointmentEditFields({
  control,
  staff,
  currentDurationMinutes,
  className,
}: AppointmentEditFieldsProps) {
  const durations = appointmentDurationOptions(currentDurationMinutes);

  return (
    <div className={className}>
      <Controller
        name="assignedPractitionerId"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>
              {L.assignedPractitionerId}
            </FieldLabel>
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id={field.name}>
                <SelectValue placeholder="Select staff" />
              </SelectTrigger>
              <SelectContent>
                {staff.map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {fieldState.error && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <Controller
        name="title"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>{L.title}</FieldLabel>
            <Input
              {...field}
              id={field.name}
              placeholder="Enter appointment title"
              aria-invalid={fieldState.invalid}
            />
            {fieldState.error && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      <div className="grid grid-cols-3 gap-4">
        <Controller
          name="date"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>{L.date}</FieldLabel>
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
              {fieldState.error && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="startTime"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>{L.startTime}</FieldLabel>
              <Input
                {...field}
                id={field.name}
                type="time"
                aria-invalid={fieldState.invalid}
              />
              {fieldState.error && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="duration"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>{L.duration}</FieldLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <SelectTrigger id={field.name}>
                  <SelectValue placeholder="Duration" />
                </SelectTrigger>
                <SelectContent>
                  {durations.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldState.error && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </div>

      <Controller
        name="notes"
        control={control}
        render={({ field }) => (
          <Field>
            <FieldLabel htmlFor={field.name}>{L.notes}</FieldLabel>
            <Textarea
              {...field}
              id={field.name}
              placeholder="Enter notes for the appointment"
              rows={4}
            />
          </Field>
        )}
      />
    </div>
  );
}
