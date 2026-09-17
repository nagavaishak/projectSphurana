'use client';

import { Button } from '@/components/ui/button';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import {
  type UpdateOrganizationIntent,
  useActiveOrganization,
  useUpdateOrganization,
} from '@/features/organization';
import {
  updateOrganizationFields,
  updateOrganizationForm,
} from '@/features/organization/api/update-organization/update-organization.form';
import { useOrgCurrency } from '@/hooks/use-org-currency';
import { micrositeBookingUrl } from '@/lib/microsite-url';
import { cn } from '@/lib/utils';
import {
  depositBasisLabels,
  depositBasisValues,
} from '@borradh-workspace/api-client/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { CalendarDays, ExternalLink, Link2 } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

const bookingModes = ['borradh', 'booking_link'] as const;
type BookingMode = (typeof bookingModes)[number];

// This tab OWNS the booking method, the deposit and the rescheduling policy.
// Every wire field is sliced out of the one org-settings declaration;
// `bookingMode` is local — it is the UI the user actually picks, and
// `primaryCalendarType` is what that choice MEANS on the wire.
// (Deposit amount is entered in major currency units, e.g. 25 = £25.)
const F = updateOrganizationFields;

const bookingsBaseSchema = z.object({
  bookingMode: z.enum(bookingModes),
  defaultBookingLink: F.defaultBookingLink.schema,
  depositEnabled: F.depositEnabled.schema,
  depositAmount: F.depositAmount.schema,
  defaultDepositBasis: F.defaultDepositBasis.schema,
  defaultDepositPercent: F.defaultDepositPercent.schema,
  customerReschedulingEnabled: F.customerReschedulingEnabled.schema,
  reschedulingNoticeRequiredHours: F.reschedulingNoticeRequiredHours.schema,
  noShowOrLateCancelFeeCents: F.noShowOrLateCancelFeeCents.schema,
  customerCancellationsEnabled: F.customerCancellationsEnabled.schema,
  cancellationNoticeRequiredHours: F.cancellationNoticeRequiredHours.schema,
});

const bookingsSchema = bookingsBaseSchema
  .refine(
    (data) => {
      if (data.bookingMode === 'booking_link') {
        return !!data.defaultBookingLink;
      }
      return true;
    },
    {
      message: 'Booking link is required when using an external booking link',
      path: ['defaultBookingLink'],
    }
  )
  .refine(
    (data) => {
      // Only the FIXED basis has an amount to require. `depositAmount` renders
      // solely under `defaultDepositBasis === 'fixed'`, so requiring it for a
      // percent deposit failed validation on a field that is not on screen —
      // zodResolver rejected, no error could be shown anywhere, and Save
      // silently did nothing for any clinic charging a percentage.
      if (data.depositEnabled && data.defaultDepositBasis === 'fixed') {
        return !!data.depositAmount && data.depositAmount > 0;
      }
      return true;
    },
    {
      message: 'Enter a deposit amount greater than 0',
      path: ['depositAmount'],
    }
  )
  .refine(
    (data) => {
      // The percent basis has its own required field, held to the 1–100 the
      // input already advertises.
      if (data.depositEnabled && data.defaultDepositBasis === 'percent') {
        return (
          !!data.defaultDepositPercent &&
          data.defaultDepositPercent > 0 &&
          data.defaultDepositPercent <= 100
        );
      }
      return true;
    },
    {
      message: 'Enter a deposit percentage between 1 and 100',
      path: ['defaultDepositPercent'],
    }
  );

type BookingsFormValues = z.infer<typeof bookingsBaseSchema>;

/**
 * Derive the booking mode from primaryCalendarType.
 * 'borradh' calendar → use Borradh booking page
 * Anything else (or null) → use external booking link
 */
function deriveBookingMode(org: {
  bookingDestination?: string | null;
  primaryCalendarType?: string | null;
  defaultBookingLink?: string | null;
}): BookingMode {
  // `bookingDestination` is the field of record (ENG-500). The legacy
  // primaryCalendarType fallback stays only until PR 2 drops that column, so
  // an org loaded before the migration still resolves to the right mode.
  if (org.bookingDestination) {
    return org.bookingDestination === 'borradh' ? 'borradh' : 'booking_link';
  }
  if (org.primaryCalendarType === 'borradh') return 'borradh';
  if (org.defaultBookingLink) return 'booking_link';
  return 'borradh';
}

export function BookingsTab({
  className,
  onCancel,
  ...props
}: React.ComponentProps<'form'> & { onCancel?: () => void }) {
  const L = updateOrganizationForm.labels;
  const {
    data: orgData,
    isPending: isOrganizationLoading,
    error: organizationError,
  } = useActiveOrganization();

  const organizationData = orgData;

  const { execute: updateOrganization, isExecuting: isUpdating } =
    useUpdateOrganization();

  const form = useForm<BookingsFormValues>({
    resolver: zodResolver(bookingsSchema),
    defaultValues: {
      bookingMode: organizationData
        ? deriveBookingMode(organizationData)
        : 'borradh',
      defaultBookingLink: organizationData?.defaultBookingLink ?? '',
      depositEnabled: organizationData?.depositEnabled ?? false,
      defaultDepositBasis: organizationData?.defaultDepositBasis ?? 'fixed',
      defaultDepositPercent: organizationData?.defaultDepositPercent ?? 20,
      depositAmount: organizationData?.depositAmount
        ? organizationData.depositAmount / 100
        : undefined,
      customerReschedulingEnabled:
        organizationData?.customerReschedulingEnabled ?? true,
      reschedulingNoticeRequiredHours:
        organizationData?.reschedulingNoticeRequiredHours != null
          ? Number(organizationData.reschedulingNoticeRequiredHours)
          : 24,
      noShowOrLateCancelFeeCents:
        organizationData?.noShowOrLateCancelFeeCents != null
          ? Number(organizationData.noShowOrLateCancelFeeCents)
          : null,
      customerCancellationsEnabled:
        organizationData?.customerCancellationsEnabled ?? true,
      cancellationNoticeRequiredHours:
        organizationData?.cancellationNoticeRequiredHours ?? 0,
    },
  });

  const selectedMode = form.watch('bookingMode');
  const depositEnabled = form.watch('depositEnabled');
  const depositBasis = form.watch('defaultDepositBasis');
  const customerCancellationsEnabled = form.watch(
    'customerCancellationsEnabled'
  );
  const customerReschedulingEnabled = form.watch('customerReschedulingEnabled');

  const { currency } = useOrgCurrency();

  const orgSlug = orgData?.slug ?? null;
  const handleCopyCalendarLink = async () => {
    if (!orgSlug) return;
    // The canonical customer url on the marketing host — not the retired
    // {dashboard}/book/{slug}, which only resolves via an edge redirect that
    // does not exist off app.borradh.io. This one gets pasted into bios.
    const url = micrositeBookingUrl(orgSlug);
    try {
      await navigator.clipboard.writeText(url);
      toast('Calendar link copied', {
        description: 'Share this so clients can book with you directly.',
      });
    } catch {
      toast.error("Couldn't copy the link — try again.");
    }
  };

  useEffect(() => {
    if (organizationData) {
      form.reset({
        bookingMode: deriveBookingMode(organizationData),
        defaultBookingLink: organizationData.defaultBookingLink ?? '',
        depositEnabled: organizationData.depositEnabled ?? false,
        defaultDepositBasis: organizationData?.defaultDepositBasis ?? 'fixed',
        defaultDepositPercent: organizationData?.defaultDepositPercent ?? 20,
        depositAmount: organizationData.depositAmount
          ? organizationData.depositAmount / 100
          : undefined,
        customerReschedulingEnabled:
          organizationData.customerReschedulingEnabled ?? true,
        reschedulingNoticeRequiredHours:
          organizationData.reschedulingNoticeRequiredHours != null
            ? Number(organizationData.reschedulingNoticeRequiredHours)
            : 24,
        noShowOrLateCancelFeeCents:
          organizationData.noShowOrLateCancelFeeCents != null
            ? Number(organizationData.noShowOrLateCancelFeeCents)
            : null,
        customerCancellationsEnabled:
          organizationData.customerCancellationsEnabled ?? true,
        cancellationNoticeRequiredHours:
          organizationData.cancellationNoticeRequiredHours ?? 0,
      });
    }
  }, [organizationData, form]);

  async function onSubmit(values: BookingsFormValues) {
    // Derive the wire fields from the booking-mode UI, then hand them to the
    // shared builder as intent. Only the keys set here are patched.
    const payload: UpdateOrganizationIntent = {};

    switch (values.bookingMode) {
      case 'borradh':
        // Write the field of record; the service keeps the legacy column in
        // step while both exist (ENG-500).
        payload.bookingDestination = 'borradh';
        payload.defaultBookingLink = null;
        break;
      case 'booking_link':
        payload.bookingDestination = 'external_link';
        payload.defaultBookingLink = values.defaultBookingLink || null;
        break;
    }

    // Per-clinic deposit (stored in cents). Disabled or 0 → no payment step.
    payload.depositEnabled = values.depositEnabled;
    // Basis and percentage are only sent while deposits are ON — with them off
    // there is no deposit for a basis to describe, and patching them would
    // rewrite settings the user never opened.
    if (values.depositEnabled) {
      payload.defaultDepositBasis = values.defaultDepositBasis;
      // Sent as entered even when the basis is `fixed`. resolveBookingPayment
      // reads only the one the basis selects, so the other is inert — and
      // keeping it means switching basis back doesn't wipe the typed figure.
      payload.defaultDepositPercent = values.defaultDepositPercent ?? null;
    }
    payload.depositAmount =
      values.depositEnabled && values.depositAmount
        ? Math.round(values.depositAmount * 100)
        : 0;

    // Rescheduling policy. `customerReschedulingEnabled` gates the customer's
    // portal self-reschedule; the notice window is a general policy (staff use
    // it too), so it is always sent.
    payload.customerReschedulingEnabled = values.customerReschedulingEnabled;
    if (values.reschedulingNoticeRequiredHours !== undefined) {
      payload.reschedulingNoticeRequiredHours =
        values.reschedulingNoticeRequiredHours;
    }
    payload.noShowOrLateCancelFeeCents =
      values.noShowOrLateCancelFeeCents ?? null;

    // Customer cancellations (patient portal). The notice window is only sent
    // while the toggle is ON — switching it off keeps the stored hours, so
    // re-enabling doesn't wipe the clinic's setting.
    payload.customerCancellationsEnabled = values.customerCancellationsEnabled;
    if (values.customerCancellationsEnabled) {
      payload.cancellationNoticeRequiredHours =
        values.cancellationNoticeRequiredHours ?? 0;
    }

    await updateOrganization(payload);
  }

  if (isOrganizationLoading) {
    return (
      <div className={cn('flex flex-col px-6 py-4 gap-6', className)}>
        <div className="animate-pulse space-y-6">
          <div className="h-12 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
          <div className="h-12 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if (organizationError) {
    return (
      <div className={cn('flex flex-col px-6 py-4 gap-6', className)}>
        <div className="text-destructive">
          Error loading organization data: {organizationError.message}
        </div>
      </div>
    );
  }

  return (
    <form
      className={cn('flex flex-col px-6 py-4', className)}
      onSubmit={form.handleSubmit(onSubmit)}
      {...props}
    >
      <Controller
        name="bookingMode"
        control={form.control}
        render={({ field }) => (
          <FieldSet>
            <FieldLegend>{L.bookingDestination}</FieldLegend>
            <FieldDescription className="-mt-2 mb-1">
              Choose how clients book appointments with your organization.
            </FieldDescription>
            <RadioGroup
              aria-label={L.bookingDestination}
              value={field.value}
              onValueChange={field.onChange}
            >
              {/* Borradh Calendar */}
              <FieldLabel>
                <Field orientation="horizontal">
                  <RadioGroupItem value="borradh" />
                  <FieldContent>
                    <FieldTitle>
                      <CalendarDays className="size-4" />
                      Borradh Calendar
                    </FieldTitle>
                    <FieldDescription>
                      Use the built-in calendar and booking system.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>

              {/* Booking Link */}
              <FieldLabel>
                <Field orientation="horizontal">
                  <RadioGroupItem value="booking_link" />
                  <FieldContent>
                    <FieldTitle>
                      <ExternalLink className="size-4" />
                      Booking Link
                    </FieldTitle>
                    <FieldDescription>
                      Use an external URL where clients can book directly.
                    </FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            </RadioGroup>
          </FieldSet>
        )}
      />

      {/* Calendar link (shown only for the built-in Borradh calendar) */}
      {selectedMode === 'borradh' && (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-lg border px-4 py-3">
          <div className="min-w-0">
            <p className="font-medium text-sm">Your calendar link</p>
            <p className="truncate text-muted-foreground text-sm">
              Share this so clients can book with you directly.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCopyCalendarLink}
            disabled={!orgSlug}
            aria-label="Copy your booking calendar link"
            className="shrink-0"
          >
            <Link2 className="size-4" />
            Copy calendar link
          </Button>
        </div>
      )}

      {/* Booking link URL input (shown only when booking_link is selected) */}
      {selectedMode === 'booking_link' && (
        <div className="mt-4">
          <Controller
            name="defaultBookingLink"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={field.name} className="font-medium">
                  {L.defaultBookingLink}
                </FieldLabel>
                <Input
                  {...field}
                  value={field.value ?? ''}
                  id={field.name}
                  type="url"
                  placeholder="https://booking.example.com"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
        </div>
      )}

      {/* Deposit settings — only relevant for the built-in Borradh flow. */}
      {selectedMode === 'borradh' && (
        <>
          <Separator className="my-4" />

          <Controller
            name="depositEnabled"
            control={form.control}
            render={({ field }) => (
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>{L.depositEnabled}</FieldTitle>
                  <FieldDescription>
                    Clients pay a deposit via card to confirm their booking.
                    Requires a connected Stripe account.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-label={L.depositEnabled}
                />
              </Field>
            )}
          />

          {depositEnabled && (
            <div className="mt-4 space-y-4">
              <Controller
                name="defaultDepositBasis"
                control={form.control}
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor={field.name} className="font-medium">
                      {L.defaultDepositBasis}
                    </FieldLabel>
                    <FieldDescription>
                      A percentage scales with each service's price; a fixed
                      amount is the same for every booking.
                    </FieldDescription>
                    <Select
                      value={field.value}
                      onValueChange={(v) =>
                        field.onChange(v as 'fixed' | 'percent')
                      }
                    >
                      <SelectTrigger id={field.name} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {depositBasisValues.map((value) => (
                          <SelectItem key={value} value={value}>
                            {depositBasisLabels[value]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />

              {depositBasis === 'percent' && (
                <Controller
                  name="defaultDepositPercent"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name} className="font-medium">
                        {L.defaultDepositPercent}
                      </FieldLabel>
                      <FieldDescription>
                        Share of the service price, rounded up to the nearest
                        50c. Services priced "on consultation" fall back to no
                        deposit.
                      </FieldDescription>
                      <InputGroup>
                        <InputGroupInput
                          id={field.name}
                          type="number"
                          min={1}
                          max={100}
                          step="1"
                          inputMode="numeric"
                          placeholder="20"
                          value={field.value ?? ''}
                          onChange={(e) =>
                            field.onChange(
                              e.target.value === ''
                                ? undefined
                                : e.target.valueAsNumber
                            )
                          }
                          onBlur={field.onBlur}
                          aria-invalid={fieldState.invalid}
                        />
                        <InputGroupAddon className="bg-muted text-foreground">
                          %
                        </InputGroupAddon>
                      </InputGroup>
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              )}

              {depositBasis === 'fixed' && (
                <Controller
                  name="depositAmount"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor={field.name} className="font-medium">
                        {L.depositAmount}
                      </FieldLabel>
                      <FieldDescription>
                        Amount charged per booking (in your account currency).
                      </FieldDescription>
                      <Input
                        id={field.name}
                        type="number"
                        min={0}
                        step="0.01"
                        inputMode="decimal"
                        placeholder="25.00"
                        value={field.value ?? ''}
                        onChange={(e) =>
                          field.onChange(
                            e.target.value === ''
                              ? undefined
                              : e.target.valueAsNumber
                          )
                        }
                        onBlur={field.onBlur}
                        aria-invalid={fieldState.invalid}
                      />
                      {fieldState.invalid && (
                        <FieldError errors={[fieldState.error]} />
                      )}
                    </Field>
                  )}
                />
              )}
            </div>
          )}
        </>
      )}

      {/* Rescheduling policy */}
      <>
        <Separator className="my-4" />

        <FieldSet>
          <FieldLegend>Rescheduling Policy</FieldLegend>
          <FieldDescription className="-mt-2 mb-1">
            Control whether clients can reschedule, the notice window, and any
            late-cancellation fee.
          </FieldDescription>

          <Controller
            name="customerReschedulingEnabled"
            control={form.control}
            render={({ field }) => (
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>{L.customerReschedulingEnabled}</FieldTitle>
                  <FieldDescription>
                    Customers can reschedule their own bookings from the portal.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-label={L.customerReschedulingEnabled}
                />
              </Field>
            )}
          />

          {customerReschedulingEnabled && (
            <Controller
              name="reschedulingNoticeRequiredHours"
              control={form.control}
              render={({ field }) => (
                <Field className="mt-2">
                  <div className="flex items-center justify-between">
                    <FieldLabel className="font-medium">
                      {L.reschedulingNoticeRequiredHours}
                    </FieldLabel>
                    <span className="text-muted-foreground text-sm">
                      {(field.value ?? 0) === 0
                        ? 'No notice needed'
                        : `${field.value} hours' notice`}
                    </span>
                  </div>
                  <Slider
                    value={[field.value ?? 0]}
                    onValueChange={([hours]) => field.onChange(hours)}
                    min={0}
                    max={48}
                    step={1}
                    aria-label={L.reschedulingNoticeRequiredHours}
                  />
                  <FieldDescription>
                    Customers can't reschedule closer to the appointment than
                    this.
                  </FieldDescription>
                </Field>
              )}
            />
          )}

          <Controller
            name="noShowOrLateCancelFeeCents"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="mt-2">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  {L.noShowOrLateCancelFeeCents}
                </FieldLabel>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    {currency.symbol}
                  </span>
                  <Input
                    {...field}
                    value={
                      field.value != null
                        ? String(Math.round(field.value / 100))
                        : ''
                    }
                    onChange={(e) =>
                      field.onChange(
                        e.target.value === ''
                          ? null
                          : Number(e.target.value) * 100
                      )
                    }
                    id={field.name}
                    type="number"
                    min={0}
                    placeholder="0"
                    className="pl-7"
                    aria-invalid={fieldState.invalid}
                  />
                </div>
                <FieldDescription>
                  Shown to customers when they cancel late, and quoted by Claire
                  — but not charged automatically. You collect it. Leave empty
                  if you don't charge one.
                </FieldDescription>
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
        </FieldSet>
      </>

      {/* Customer cancellations (patient portal self-cancellation policy) */}
      <>
        <Separator className="my-4" />

        <FieldSet>
          <FieldLegend>Customer cancellations</FieldLegend>
          <FieldDescription className="-mt-2 mb-1">
            Control whether customers can cancel bookings themselves, and how
            much notice they must give.
          </FieldDescription>

          <Controller
            name="customerCancellationsEnabled"
            control={form.control}
            render={({ field }) => (
              <Field orientation="horizontal">
                <FieldContent>
                  <FieldTitle>{L.customerCancellationsEnabled}</FieldTitle>
                  <FieldDescription>
                    Customers can cancel their own bookings from the portal.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                  aria-label={L.customerCancellationsEnabled}
                />
              </Field>
            )}
          />

          {customerCancellationsEnabled && (
            <Controller
              name="cancellationNoticeRequiredHours"
              control={form.control}
              render={({ field }) => (
                <Field className="mt-2">
                  <div className="flex items-center justify-between">
                    <FieldLabel className="font-medium">
                      {L.cancellationNoticeRequiredHours}
                    </FieldLabel>
                    <span className="text-sm text-muted-foreground">
                      {field.value === 0
                        ? 'No notice needed'
                        : `${field.value} hours' notice`}
                    </span>
                  </div>
                  <Slider
                    value={[field.value ?? 0]}
                    onValueChange={([hours]) => field.onChange(hours)}
                    min={0}
                    max={48}
                    step={1}
                    aria-label={L.cancellationNoticeRequiredHours}
                  />
                  <FieldDescription>
                    Customers can't cancel closer to the appointment than this.
                  </FieldDescription>
                </Field>
              )}
            />
          )}
        </FieldSet>
      </>

      <Separator className="my-4" />

      <div className="flex gap-2">
        <Button type="submit" disabled={isUpdating}>
          {isUpdating ? 'Saving...' : 'Submit'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
