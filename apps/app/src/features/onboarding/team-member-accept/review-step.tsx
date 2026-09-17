import {
  type CountryCode,
  countryCodeLabels,
  countryCodeValues,
} from '@borradh-workspace/api-client/types';
import { zodResolver } from '@hookform/resolvers/zod';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Field,
  FieldError,
  FieldGroup,
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

export interface ReviewValues {
  firstName: string;
  lastName: string;
  phone: string;
  country: CountryCode | '';
  acceptedTerms: boolean;
}

const reviewSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  phone: z.string().optional().default(''),
  country: z.string().optional().default(''),
  acceptedTerms: z.literal(true, {
    message: 'You must accept the terms to continue',
  }),
});

interface ReviewStepProps {
  email: string;
  defaults: Omit<ReviewValues, 'acceptedTerms'>;
  onBack: () => void;
  onContinue: (values: ReviewValues) => void;
}

/**
 * "Review and confirm" — First/Last name, Mobile, Country prefilled from the
 * invite lookup (the values the owner typed in the Profile panel). Fields are
 * editable; the Terms/Privacy checkbox is required to advance.
 */
export function ReviewStep({
  email,
  defaults,
  onBack,
  onContinue,
}: ReviewStepProps) {
  const form = useForm<ReviewValues>({
    resolver: zodResolver(reviewSchema) as never,
    defaultValues: {
      firstName: defaults.firstName ?? '',
      lastName: defaults.lastName ?? '',
      phone: defaults.phone ?? '',
      country: defaults.country ?? '',
      acceptedTerms: false,
    },
  });

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={form.handleSubmit((values) => onContinue(values))}
      noValidate
    >
      <FieldGroup className="gap-4">
        <div className="flex flex-col gap-1 text-center">
          <h1 className="text-2xl font-bold">Review and confirm</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Create your new account for <strong>{email}</strong> by completing
            these details.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Controller
            name="firstName"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1">
                <FieldLabel htmlFor={field.name}>First name</FieldLabel>
                <Input
                  {...field}
                  id={field.name}
                  aria-invalid={fieldState.invalid}
                  autoComplete="given-name"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />

          <Controller
            name="lastName"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid} className="gap-1">
                <FieldLabel htmlFor={field.name}>Last name</FieldLabel>
                <Input
                  {...field}
                  id={field.name}
                  aria-invalid={fieldState.invalid}
                  autoComplete="family-name"
                />
                {fieldState.invalid && (
                  <FieldError errors={[fieldState.error]} />
                )}
              </Field>
            )}
          />
        </div>

        <Controller
          name="phone"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="gap-1">
              <FieldLabel htmlFor={field.name}>Mobile number</FieldLabel>
              <Input
                {...field}
                id={field.name}
                type="tel"
                placeholder="+1 555 000 0000"
                aria-invalid={fieldState.invalid}
                autoComplete="tel"
              />
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="country"
          control={form.control}
          render={({ field }) => (
            <Field className="gap-1">
              <FieldLabel htmlFor="country">Country</FieldLabel>
              <Select
                value={field.value || undefined}
                onValueChange={field.onChange}
              >
                <SelectTrigger id="country" aria-label="Country">
                  <SelectValue placeholder="Select a country" />
                </SelectTrigger>
                <SelectContent>
                  {countryCodeValues.map((code) => (
                    <SelectItem key={code} value={code}>
                      {countryCodeLabels[code]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />

        <Controller
          name="acceptedTerms"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid} className="gap-1">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: label wraps a Radix Checkbox (renders a button, not a native input), so implicit association isn't statically detected */}
              <label className="flex items-start gap-3 text-sm">
                <Checkbox
                  checked={field.value}
                  onCheckedChange={(checked) =>
                    field.onChange(checked === true)
                  }
                  aria-label="Accept terms and privacy policy"
                  aria-invalid={fieldState.invalid}
                />
                <span className="text-muted-foreground">
                  I agree to the Terms of Service and Privacy Policy.
                </span>
              </label>
              {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </FieldGroup>

      <div className="flex items-center justify-between">
        <Button type="button" variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button type="submit">Continue</Button>
      </div>
    </form>
  );
}
