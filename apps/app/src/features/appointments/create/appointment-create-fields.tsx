import { format, parse } from 'date-fns';
import { type Control, Controller } from 'react-hook-form';

import { LeadPicker } from '@/components/app/lead-picker';
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
  MOBILE_SELECT_TRIGGER_CLASS,
  MOBILE_TEXTAREA_CLASS,
  MobileDateRow,
  MobileSelectionPill,
  MobileTimePickerRow,
} from '@/features/mobile-ui';
import { cn } from '@/lib/utils';

import {
  APPOINTMENT_NO_PRACTITIONER,
  type AppointmentCreateFormData,
  type AppointmentCreatePractitioner,
  type AppointmentCreateService,
  appointmentCreateForm,
  resolveAppointmentDurationMinutes,
} from './appointment-create-form';

/**
 * SHARED FIELDS — every create-appointment surface composes these, bound to the
 * shared `appointmentCreateForm`. `variant` only changes presentation
 * (desktop dialog rows vs. mobile funnel rows); the value written into the form
 * is identical, which is what keeps the form contract honest.
 *
 * Labels are rendered from the declaration (`L.x`), never as literals — the
 * contract's harness locates each control by that same string, so the JSX and
 * the field registry cannot drift apart.
 */
const L = appointmentCreateForm.labels;
export type AppointmentFieldVariant = 'desktop' | 'mobile';

interface FieldProps {
  control: Control<AppointmentCreateFormData>;
  variant?: AppointmentFieldVariant;
}

function formatDisplayDate(dateStr: string): string {
  const parsed = parse(dateStr, 'yyyy-MM-dd', new Date());
  return Number.isNaN(parsed.getTime()) ? dateStr : format(parsed, 'EEE d MMM');
}

/** Client picker (leadId). */
export function AppointmentClientField({ control }: FieldProps) {
  return (
    <Controller
      name="leadId"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{L.leadId}</FieldLabel>
          <LeadPicker
            value={field.value}
            onValueChange={(leadId) => field.onChange(leadId)}
            placeholder="Select a client"
          />
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

/** Service picker (serviceId). Duration + title are derived from it. */
export function AppointmentServiceField({
  control,
  services,
  isLoading,
  variant = 'desktop',
}: FieldProps & {
  services: AppointmentCreateService[];
  isLoading?: boolean;
}) {
  return (
    <Controller
      name="serviceId"
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={field.name}>{L.serviceId}</FieldLabel>
          <Select
            value={field.value}
            onValueChange={field.onChange}
            disabled={isLoading}
          >
            <SelectTrigger
              id={field.name}
              className={cn(
                variant === 'mobile' && MOBILE_SELECT_TRIGGER_CLASS
              )}
            >
              <SelectValue placeholder="Select a service" />
            </SelectTrigger>
            <SelectContent>
              {services.map((service) => (
                <SelectItem key={service.id} value={service.id}>
                  {service.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {fieldState.error && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  );
}

/**
 * Practitioner picker. Optional: `APPOINTMENT_NO_PRACTITIONER` means the
 * booking is left unassigned — we never silently invent one.
 */
export function AppointmentPractitionerField({
  control,
  practitioners,
  variant = 'desktop',
}: FieldProps & { practitioners: AppointmentCreatePractitioner[] }) {
  return (
    <Controller
      name="practitionerId"
      control={control}
      render={({ field }) => {
        const value = field.value || APPOINTMENT_NO_PRACTITIONER;

        if (variant === 'mobile') {
          return (
            <div className="flex flex-wrap gap-2">
              <MobileSelectionPill
                label="Any team member"
                selected={value === APPOINTMENT_NO_PRACTITIONER}
                onClick={() => field.onChange(APPOINTMENT_NO_PRACTITIONER)}
              />
              {practitioners.map((p) => (
                <MobileSelectionPill
                  key={p.id}
                  label={p.name}
                  selected={value === p.id}
                  onClick={() => field.onChange(p.id)}
                />
              ))}
            </div>
          );
        }

        return (
          <Field>
            <FieldLabel htmlFor={field.name}>{L.practitionerId}</FieldLabel>
            <Select value={value} onValueChange={field.onChange}>
              <SelectTrigger id={field.name}>
                <SelectValue placeholder="Any team member" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={APPOINTMENT_NO_PRACTITIONER}>
                  Any team member
                </SelectItem>
                {practitioners.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        );
      }}
    />
  );
}

/** Date + start time. End time is always start + the service's duration. */
export function AppointmentDateTimeFields({
  control,
  variant = 'desktop',
}: FieldProps) {
  if (variant === 'mobile') {
    return (
      <section>
        <p className="pb-2 text-[13px] text-[#8E8E93]">When</p>
        <div className="divide-y divide-[#E5E5EA] overflow-hidden rounded-xl border border-[#E5E5EA]">
          <Controller
            name="date"
            control={control}
            render={({ field }) => (
              <MobileDateRow
                label={L.date}
                value={formatDisplayDate(field.value)}
                selected={parse(field.value, 'yyyy-MM-dd', new Date())}
                onSelect={(date) => field.onChange(format(date, 'yyyy-MM-dd'))}
              />
            )}
          />
          <Controller
            name="startTime"
            control={control}
            render={({ field }) => (
              <MobileTimePickerRow
                label={L.startTime}
                value={field.value}
                onChange={field.onChange}
              />
            )}
          />
        </div>
      </section>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4">
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
            <Input {...field} id={field.name} type="time" />
            {fieldState.error && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
    </div>
  );
}

/** Free-text notes → the appointment's `description`. */
export function AppointmentNotesField({
  control,
  variant = 'desktop',
}: FieldProps) {
  return (
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
            rows={3}
            className={cn(variant === 'mobile' && MOBILE_TEXTAREA_CLASS)}
          />
        </Field>
      )}
    />
  );
}

/**
 * Read-only summary of the derived appointment: the title comes from the
 * service and the duration is the service's own length. Rendered so users can
 * see what they're about to book without being asked to type it.
 */
export function AppointmentDerivedSummary({
  service,
  className,
}: {
  service: AppointmentCreateService | undefined;
  className?: string;
}) {
  const duration = resolveAppointmentDurationMinutes(service);
  return (
    <div
      className={cn(
        'rounded-xl border border-[#E5E5EA] bg-white px-3 py-2.5',
        className
      )}
    >
      <p className="text-[13px] text-[#8E8E93]">Appointment</p>
      <p className="text-[15px] font-medium text-black">
        {service?.name ?? 'Appointment'}
      </p>
      <p className="text-[13px] text-[#8E8E93]">{duration} min</p>
    </div>
  );
}
