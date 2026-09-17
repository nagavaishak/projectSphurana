'use client';

import { Button } from '@/components/ui/button';
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
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import {
  useGetOrgDefaults,
  useUpdateOrgDefaults,
} from '@/features/org-defaults';
import { useListServices } from '@/features/organization-services';
import { cn } from '@/lib/utils';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

/**
 * Form schema — accepts strings for number fields so the input doesn't
 * fight react-hook-form when the user clears the field. Conversion to
 * `number | null` happens at submit time.
 *
 * `videoOrientation` mirrors the API enum. `defaultServiceIdForAds` uses
 * the sentinel `"__none__"` for the "no default" option since shadcn's
 * Select can't render an empty-string `SelectItem`.
 */
const defaultsSchema = z.object({
  adDailyBudgetEuros: z
    .string()
    .refine((v) => v === '' || /^\d+(?:\.\d{1,2})?$/.test(v), {
      message: 'Enter a positive amount in euros (e.g. 10 or 12.50)',
    }),
  adObjective: z.enum([
    'OUTCOME_LEADS',
    'OUTCOME_TRAFFIC',
    'OUTCOME_AWARENESS',
  ]),
  videoOrientation: z.enum(['landscape', 'portrait', 'square']),
  videoLengthSecs: z.string().refine((v) => v === '' || /^\d+$/.test(v), {
    message: 'Enter a whole number of seconds',
  }),
  brandVoice: z.string(),
  defaultServiceIdForAds: z.string(),
});

type DefaultsFormValues = z.infer<typeof defaultsSchema>;

const AD_OBJECTIVE_OPTIONS: Array<{
  value: 'OUTCOME_LEADS' | 'OUTCOME_TRAFFIC' | 'OUTCOME_AWARENESS';
  label: string;
}> = [
  { value: 'OUTCOME_LEADS', label: 'Leads' },
  { value: 'OUTCOME_TRAFFIC', label: 'Traffic' },
  { value: 'OUTCOME_AWARENESS', label: 'Awareness' },
];

const VIDEO_ORIENTATION_OPTIONS: Array<{
  value: 'landscape' | 'portrait' | 'square';
  label: string;
}> = [
  { value: 'landscape', label: 'Landscape (16:9)' },
  { value: 'portrait', label: 'Portrait (9:16)' },
  { value: 'square', label: 'Square (1:1)' },
];

const NO_SERVICE_SENTINEL = '__none__';

function eurosToCents(value: string): number | null {
  if (!value) return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100);
}

function centsToEuros(cents: number): string {
  const euros = cents / 100;
  return Number.isInteger(euros) ? String(euros) : euros.toFixed(2);
}

export function DefaultsTab({
  className,
  onCancel,
}: { className?: string; onCancel?: () => void }) {
  const { defaults, isLoading, isError, error } = useGetOrgDefaults();
  const { services } = useListServices();
  const { updateDefaults, isUpdating } = useUpdateOrgDefaults();

  const form = useForm<DefaultsFormValues>({
    resolver: zodResolver(defaultsSchema),
    defaultValues: {
      adDailyBudgetEuros: '',
      adObjective: 'OUTCOME_LEADS',
      videoOrientation: 'landscape',
      videoLengthSecs: '',
      brandVoice: '',
      defaultServiceIdForAds: NO_SERVICE_SENTINEL,
    },
  });

  // Hydrate the form once defaults arrive. Re-run if defaults change after
  // a save so the form reflects the canonical values (e.g. clearing an
  // override returns the form to the system default).
  useEffect(() => {
    if (!defaults) return;
    form.reset({
      adDailyBudgetEuros: centsToEuros(defaults.adDailyBudgetCents),
      adObjective:
        (defaults.adObjective as DefaultsFormValues['adObjective']) ??
        'OUTCOME_LEADS',
      videoOrientation:
        (defaults.videoOrientation as DefaultsFormValues['videoOrientation']) ??
        'landscape',
      videoLengthSecs: String(defaults.videoLengthSecs),
      brandVoice: defaults.brandVoice ?? '',
      defaultServiceIdForAds:
        defaults.defaultServiceIdForAds ?? NO_SERVICE_SENTINEL,
    });
  }, [defaults, form]);

  if (isLoading) {
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

  if (isError) {
    return (
      <div className={cn('flex flex-col px-6 py-4 gap-6', className)}>
        <div className="text-destructive">
          Error loading defaults: {error?.message ?? 'Unknown error'}
        </div>
      </div>
    );
  }

  if (!defaults) return null;

  const anyOverrides = Object.values(defaults.overrides).some(Boolean);

  async function onSubmit(values: DefaultsFormValues) {
    // Only send dirty fields. Clearing a value (empty string) maps to
    // `null` so the column is cleared and reads fall back to the system
    // default. Service uses the sentinel for "(none)".
    const dirty = form.formState.dirtyFields;
    const patch: Record<string, unknown> = {};

    if (dirty.adDailyBudgetEuros) {
      patch.adDailyBudgetCents = eurosToCents(values.adDailyBudgetEuros);
    }
    if (dirty.adObjective) {
      patch.adObjective = values.adObjective;
    }
    if (dirty.videoOrientation) {
      patch.videoOrientation = values.videoOrientation;
    }
    if (dirty.videoLengthSecs) {
      const n = values.videoLengthSecs
        ? Number.parseInt(values.videoLengthSecs, 10)
        : null;
      patch.videoLengthSecs = n && n > 0 ? n : null;
    }
    if (dirty.brandVoice) {
      patch.brandVoice = values.brandVoice.trim() || null;
    }
    if (dirty.defaultServiceIdForAds) {
      patch.defaultServiceIdForAds =
        values.defaultServiceIdForAds === NO_SERVICE_SENTINEL
          ? null
          : values.defaultServiceIdForAds;
    }

    if (Object.keys(patch).length === 0) return;
    updateDefaults(patch);
  }

  return (
    <form
      className={cn('flex flex-col px-6 py-4', className)}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      {!anyOverrides && (
        <div className="mb-4 rounded-md border border-dashed bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          No overrides yet — Claire is using sensible system defaults for this
          organization. Edit any field below to customise.
        </div>
      )}

      <div className="space-y-0">
        <Controller
          name="adDailyBudgetEuros"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  Ad daily budget (€)
                </FieldLabel>
                <FieldDescription>
                  {defaults.overrides.adDailyBudgetCents
                    ? 'Set for this organization.'
                    : 'Using system default (€10/day).'}
                </FieldDescription>
              </div>
              <div className="w-48">
                <Input
                  {...field}
                  id={field.name}
                  type="text"
                  inputMode="decimal"
                  placeholder="10"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />

        <Separator />

        <Controller
          name="adObjective"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  Ad objective
                </FieldLabel>
                <FieldDescription>
                  {defaults.overrides.adObjective
                    ? 'Set for this organization.'
                    : 'Using system default (Leads).'}
                </FieldDescription>
              </div>
              <div className="w-48">
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AD_OBJECTIVE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />

        <Separator />

        <Controller
          name="videoOrientation"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  Video orientation
                </FieldLabel>
                <FieldDescription>
                  {defaults.overrides.videoOrientation
                    ? 'Set for this organization.'
                    : 'Using system default (Landscape).'}
                </FieldDescription>
              </div>
              <div className="w-48">
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VIDEO_ORIENTATION_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />

        <Separator />

        <Controller
          name="videoLengthSecs"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  Video length (seconds)
                </FieldLabel>
                <FieldDescription>
                  {defaults.overrides.videoLengthSecs
                    ? 'Set for this organization.'
                    : 'Using system default (60s).'}
                </FieldDescription>
              </div>
              <div className="w-48">
                <Input
                  {...field}
                  id={field.name}
                  type="text"
                  inputMode="numeric"
                  placeholder="60"
                  aria-invalid={fieldState.invalid}
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />

        <Separator />

        <Controller
          name="defaultServiceIdForAds"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field
              orientation="horizontal"
              className="py-4"
              data-invalid={fieldState.invalid}
            >
              <div className="flex-1">
                <FieldLabel htmlFor={field.name} className="font-medium">
                  Default service for ads
                </FieldLabel>
                <FieldDescription>
                  {defaults.overrides.defaultServiceIdForAds
                    ? 'Set for this organization.'
                    : 'Not set — Claire picks a service per request.'}
                </FieldDescription>
              </div>
              <div className="w-48">
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger
                    id={field.name}
                    aria-invalid={fieldState.invalid}
                  >
                    <SelectValue placeholder="(none)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_SERVICE_SENTINEL}>(none)</SelectItem>
                    {services.map((svc) => (
                      <SelectItem key={svc.id} value={svc.id}>
                        {svc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </div>
            </Field>
          )}
        />

        <Separator />

        <Controller
          name="brandVoice"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field className="py-4" data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name} className="font-medium">
                Brand voice
              </FieldLabel>
              <FieldDescription>
                {defaults.overrides.brandVoice
                  ? 'Set for this organization.'
                  : 'Not set — Claire infers tone from your org profile.'}{' '}
                Free-form text Claire reads to influence ad copy and video
                scripts.
              </FieldDescription>
              <Textarea
                {...field}
                id={field.name}
                rows={5}
                placeholder="e.g. Warm, expert, never pushy. Speak directly to the patient — not 'we offer', but 'you get'."
                aria-invalid={fieldState.invalid}
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </div>

      <Separator className="my-4" />

      <div className="flex gap-2">
        <Button type="submit" disabled={isUpdating || !form.formState.isDirty}>
          {isUpdating ? 'Saving...' : 'Save changes'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
