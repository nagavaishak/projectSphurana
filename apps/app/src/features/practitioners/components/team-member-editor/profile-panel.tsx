import {
  countryCodeLabels,
  countryCodeValues,
  employmentTypeLabels,
  employmentTypeValues,
} from '@borradh-workspace/api-client/types';
import { userColorLabels, userColorValues } from '@borradh-workspace/labels';
import { format, parse } from 'date-fns';
import { CheckIcon, Loader2, PencilIcon, UserIcon } from 'lucide-react';
import { useRef, useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ImageCropDialog } from '@/features/upload';
import { useUploadImage } from '@/features/upload/api/upload.hook';
import { cn } from '@/lib/utils';

import { type TeamMemberFormValues, teamMemberForm } from './types';

/**
 * Labels come from the form declaration, not from literals here. The contract
 * harness locates each control by the same string, so the label a user reads and
 * the label the test looks for cannot drift — and a control deleted from this
 * JSX makes its field unreachable, which the harness reports.
 */
const L = teamMemberForm.labels;

/** Hex tints for the 6-value calendar-color enum (matches the swatch grid). */
const COLOR_HEX: Record<string, string> = {
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
  yellow: '#eab308',
  purple: '#a855f7',
  orange: '#f97316',
};

/** `yyyy-MM-dd` string <-> Date, TZ-safe (parses as local midnight). */
function parseDateValue(value: string): Date | undefined {
  if (!value) return undefined;
  const parsed = parse(value, 'yyyy-MM-dd', new Date());
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function formatDateValue(date: Date | undefined): string {
  return date ? format(date, 'yyyy-MM-dd') : '';
}

interface ProfilePanelProps {
  form: UseFormReturn<TeamMemberFormValues>;
}

export function ProfilePanel({ form }: ProfilePanelProps) {
  const {
    register,
    control,
    watch,
    setValue,
    formState: { errors },
  } = form;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const { uploadAsync, isUploading } = useUploadImage({
    purpose: 'profile',
    showToast: false,
  });
  const photo = watch('photo');
  const firstName = watch('firstName');

  const onPhotoCropped = async (file: File) => {
    setPendingFile(null);
    const result = await uploadAsync(file);
    setValue('photo', result.url, { shouldDirty: true });
  };

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-5">
        <h3 className="text-lg font-semibold">Profile</h3>

        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar className="size-20">
              {photo ? <AvatarImage src={photo} alt="" /> : null}
              <AvatarFallback className="text-xl">
                {firstName?.trim()?.[0]?.toUpperCase() ?? (
                  <UserIcon className="size-7 text-muted-foreground" />
                )}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              aria-label={L.photo}
              className="absolute -bottom-1 -right-1 flex size-8 items-center justify-center rounded-full border bg-background shadow-sm transition hover:bg-muted"
            >
              {isUploading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <PencilIcon className="size-4" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) setPendingFile(file);
                e.target.value = '';
              }}
            />
          </div>
          <ImageCropDialog
            file={pendingFile}
            onCancel={() => setPendingFile(null)}
            onCropped={onPhotoCropped}
            description="Drag and resize the circle to frame the profile photo."
          />
          <div className="text-sm text-muted-foreground">
            Add a profile picture, or let the team member add one during
            onboarding.
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.firstName}>
            <FieldLabel htmlFor="tm-first-name">{L.firstName}</FieldLabel>
            <Input
              id="tm-first-name"
              placeholder="e.g. Kody"
              aria-invalid={!!errors.firstName}
              {...register('firstName')}
            />
            {errors.firstName && (
              <FieldError errors={[{ message: errors.firstName.message }]} />
            )}
          </Field>

          <Field data-invalid={!!errors.lastName}>
            <FieldLabel htmlFor="tm-last-name">{L.lastName}</FieldLabel>
            <Input
              id="tm-last-name"
              placeholder="e.g. Bro"
              aria-invalid={!!errors.lastName}
              {...register('lastName')}
            />
            {errors.lastName && (
              <FieldError errors={[{ message: errors.lastName.message }]} />
            )}
          </Field>
        </div>

        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="tm-email">{L.email}</FieldLabel>
          <Input
            id="tm-email"
            type="email"
            placeholder="e.g. johndoe@example.com"
            aria-invalid={!!errors.email}
            {...register('email')}
          />
          {errors.email && (
            <FieldError errors={[{ message: errors.email.message }]} />
          )}
        </Field>

        {/*
          `phone` / `phoneCountry` / `phoneSecondary` are in the form schema AND
          in `create-team-member.payload.ts`, so the API stores whatever the UI
          sends. These inputs are the only way to produce that value — they were
          dropped in the mobile/form-parity sweep, which made the field
          unreachable while every payload-level test stayed green (the builder
          still maps it; both surfaces share this panel, so parity still held).
        */}
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Field>
            <FieldLabel htmlFor="tm-phone-country">{L.phoneCountry}</FieldLabel>
            <Input
              id="tm-phone-country"
              placeholder="+353"
              {...register('phoneCountry')}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tm-phone">{L.phone}</FieldLabel>
            <Input id="tm-phone" type="tel" {...register('phone')} />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="tm-phone-secondary">
            {L.phoneSecondary}
          </FieldLabel>
          <Input
            id="tm-phone-secondary"
            type="tel"
            {...register('phoneSecondary')}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="tm-country">{L.country}</FieldLabel>
          <Controller
            name="country"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value || undefined}
                onValueChange={field.onChange}
              >
                <SelectTrigger id="tm-country">
                  <SelectValue placeholder="Select country" />
                </SelectTrigger>
                <SelectContent>
                  {countryCodeValues.map((value) => (
                    <SelectItem key={value} value={value}>
                      {countryCodeLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        {/*
          `dateOfBirth` and `color` are in the form schema AND in
          `create-team-member.payload.ts` / the editor's update intent. These
          controls are the only way a user can produce those values — they were
          dropped in the same mobile/form-parity sweep that took the phone
          inputs, which left both fields unreachable while every payload-level
          test stayed green (the builder still maps them; both surfaces share
          this panel, so parity still held).
        */}
        <Field>
          <FieldLabel htmlFor="tm-dob">{L.dateOfBirth}</FieldLabel>
          <Input id="tm-dob" type="date" {...register('dateOfBirth')} />
        </Field>

        <Field>
          <FieldLabel>{L.color}</FieldLabel>
          <Controller
            name="color"
            control={control}
            render={({ field }) => (
              <div className="flex flex-wrap gap-2">
                {userColorValues.map((value) => {
                  const selected = field.value === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-label={userColorLabels[value]}
                      aria-pressed={selected}
                      onClick={() => field.onChange(selected ? '' : value)}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-background transition',
                        selected && 'ring-2 ring-ring'
                      )}
                      style={{ backgroundColor: COLOR_HEX[value] }}
                    >
                      {selected && <CheckIcon className="size-4 text-white" />}
                    </button>
                  );
                })}
              </div>
            )}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="tm-job-title">{L.jobTitle}</FieldLabel>
          <Input
            id="tm-job-title"
            placeholder="e.g. Senior Stylist"
            {...register('jobTitle')}
          />
          <FieldDescription>Visible to clients online.</FieldDescription>
        </Field>
      </section>

      <section className="flex flex-col gap-5">
        <h3 className="text-lg font-semibold">Work details</h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="tm-start-date">
              {L.employmentStartDate}
            </FieldLabel>
            <Controller
              name="employmentStartDate"
              control={control}
              render={({ field }) => (
                <DatePicker
                  id="tm-start-date"
                  placeholder="Select start date"
                  value={parseDateValue(field.value)}
                  onChange={(date) => field.onChange(formatDateValue(date))}
                />
              )}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="tm-end-date">{L.employmentEndDate}</FieldLabel>
            <Controller
              name="employmentEndDate"
              control={control}
              render={({ field }) => (
                <DatePicker
                  id="tm-end-date"
                  placeholder="Select end date"
                  value={parseDateValue(field.value)}
                  onChange={(date) => field.onChange(formatDateValue(date))}
                />
              )}
            />
          </Field>
        </div>

        <Field>
          <FieldLabel htmlFor="tm-employment-type">
            {L.employmentType}
          </FieldLabel>
          <Controller
            name="employmentType"
            control={control}
            render={({ field }) => (
              <Select
                value={field.value || undefined}
                onValueChange={field.onChange}
              >
                <SelectTrigger id="tm-employment-type">
                  <SelectValue placeholder="Select employment type" />
                </SelectTrigger>
                <SelectContent>
                  {employmentTypeValues.map((value) => (
                    <SelectItem key={value} value={value}>
                      {employmentTypeLabels[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="tm-ref">{L.teamMemberRef}</FieldLabel>
          <Input
            id="tm-ref"
            placeholder="e.g. EMP-00123"
            {...register('teamMemberRef')}
          />
          <FieldDescription>
            Identifier used for external systems like payroll.
          </FieldDescription>
        </Field>

        <Field data-invalid={!!errors.notes}>
          <FieldLabel htmlFor="tm-notes">{L.notes}</FieldLabel>
          <Textarea
            id="tm-notes"
            rows={4}
            maxLength={1000}
            placeholder="Add a private note only viewable in the team member list"
            aria-invalid={!!errors.notes}
            {...register('notes')}
          />
          {errors.notes && (
            <FieldError errors={[{ message: errors.notes.message }]} />
          )}
        </Field>
      </section>
    </div>
  );
}
