import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface Step1BusinessProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

export function Step1Business({ form }: Step1BusinessProps) {
  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          What&apos;s your business called?
        </h1>
        <p className="text-muted-foreground">
          We&apos;ll use this to personalize your experience.
        </p>
      </div>

      <Controller
        name="companyName"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field
            className="flex flex-col gap-2"
            data-invalid={fieldState.invalid}
          >
            <FieldLabel className="text-sm font-medium" htmlFor={field.name}>
              Business Name
            </FieldLabel>
            <Input
              {...field}
              id={field.name}
              placeholder="Enter your business name"
              aria-invalid={fieldState.invalid}
              autoComplete="organization"
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />
    </FieldGroup>
  );
}
