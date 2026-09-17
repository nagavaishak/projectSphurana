import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface Step3WebsiteAnalysisProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
  isAnalyzing?: boolean;
}

/**
 * Step 3: Website Scanner
 * URL inputs only. Analysis is triggered by the Continue button via onBeforeContinue.
 */
export function Step3WebsiteAnalysis({
  form,
  isAnalyzing,
}: Step3WebsiteAnalysisProps) {
  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Enter your website</h1>
        <p className="text-muted-foreground">
          We&apos;ll analyze your website and booking system to auto-fill your
          business details. You can skip this step if you don&apos;t have
          either.
        </p>
      </div>

      {/* Website URL */}
      <Controller
        name="websiteUrl"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field
            className="flex flex-col gap-2"
            data-invalid={fieldState.invalid}
          >
            <FieldLabel
              className="text-secondary-foreground text-sm font-medium"
              htmlFor={field.name}
              aria-invalid={fieldState.invalid}
            >
              Website URL (optional)
            </FieldLabel>
            <Input
              {...field}
              id={field.name}
              type="url"
              placeholder="https://www.yourbusiness.com"
              aria-invalid={fieldState.invalid}
              autoComplete="url"
              disabled={isAnalyzing}
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      {/* Booking System URL */}
      <Controller
        name="bookingSystemUrl"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field
            className="flex flex-col gap-2"
            data-invalid={fieldState.invalid}
          >
            <FieldLabel
              className="text-secondary-foreground text-sm font-medium"
              htmlFor={field.name}
              aria-invalid={fieldState.invalid}
            >
              Booking System Link (optional)
            </FieldLabel>
            <p className="text-muted-foreground text-xs">
              If you use an online booking system (e.g. Fresha, Treatwell,
              Phorest), paste the link here and we&apos;ll scan it for your
              services and prices.
            </p>
            <Input
              {...field}
              id={field.name}
              type="url"
              placeholder="https://www.fresha.com/book-now/your-salon"
              aria-invalid={fieldState.invalid}
              autoComplete="url"
              disabled={isAnalyzing}
            />
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
          </Field>
        )}
      />

      {/* Loading State */}
      {isAnalyzing && (
        <div className="space-y-3 rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">
            Analyzing your website and booking system...
          </p>
          <div className="space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      )}
    </FieldGroup>
  );
}
