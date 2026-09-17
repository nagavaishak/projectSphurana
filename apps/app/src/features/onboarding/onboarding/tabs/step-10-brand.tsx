import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Palette, Sparkles } from 'lucide-react';
import { useEffect } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface Step10BrandProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type varies
  form: UseFormReturn<any>;
  organizationId?: string;
}

// Simple color input component with preview
function ColorInput({
  value,
  onChange,
  id,
  disabled,
}: {
  value: string;
  onChange: (value: string) => void;
  id: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className="size-10 shrink-0 rounded-md border shadow-sm"
        style={{ backgroundColor: value || '#6366f1' }}
      />
      <div className="relative flex-1">
        <Input
          id={id}
          type="text"
          value={value || ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#6366f1"
          className="pr-10 font-mono text-sm"
          disabled={disabled}
        />
        <input
          type="color"
          value={value || '#6366f1'}
          onChange={(e) => onChange(e.target.value)}
          className="absolute right-2 top-1/2 size-6 -translate-y-1/2 cursor-pointer rounded border-0 bg-transparent p-0"
          disabled={disabled}
        />
      </div>
    </div>
  );
}

export function Step10Brand({ form, organizationId }: Step10BrandProps) {
  const { control, watch, setValue } = form;

  // Set default values if not already set
  useEffect(() => {
    const primaryColor = watch('primaryColor');
    const secondaryColor = watch('secondaryColor');

    if (!primaryColor) {
      setValue('primaryColor', '#6366f1');
    }
    if (!secondaryColor) {
      setValue('secondaryColor', '#8b5cf6');
    }
  }, [watch, setValue]);

  const primaryColor = watch('primaryColor') || '#6366f1';
  const secondaryColor = watch('secondaryColor') || '#8b5cf6';
  const tagline = watch('tagline') || '';

  // No org yet - show informational UI
  if (!organizationId) {
    return (
      <FieldGroup className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">Brand Settings</h1>
          <p className="text-sm text-muted-foreground">
            Customize your brand colors and tagline for a consistent look.
          </p>
        </div>

        <div className="rounded-lg border border-dashed border-muted-foreground/25 bg-muted/50 p-6 text-center">
          <Palette className="mx-auto size-10 text-muted-foreground/50" />
          <p className="mt-2 text-sm text-muted-foreground">
            Brand settings will be available after your organization is created.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            You can skip this step and customize later in Settings.
          </p>
        </div>
      </FieldGroup>
    );
  }

  return (
    <FieldGroup className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Brand Settings</h1>
        <p className="text-sm text-muted-foreground">
          Customize your brand colors and tagline for AI-generated content.
        </p>
      </div>

      {/* Preview Card */}
      <div className="rounded-lg border p-4">
        <p className="mb-3 text-xs font-medium text-muted-foreground">
          Preview
        </p>
        <div className="flex flex-col gap-3">
          <div
            className="rounded-lg p-4 text-white"
            style={{
              background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`,
            }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="size-5" />
              <span className="font-semibold">Your Brand</span>
            </div>
            {tagline && <p className="mt-2 text-sm opacity-90">{tagline}</p>}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: primaryColor }}
            >
              Primary Button
            </button>
            <button
              type="button"
              className="rounded-md px-4 py-2 text-sm font-medium text-white transition-colors"
              style={{ backgroundColor: secondaryColor }}
            >
              Secondary Button
            </button>
          </div>
        </div>
      </div>

      {/* Color Inputs */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Controller
          name="primaryColor"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Primary Color</FieldLabel>
              <FieldDescription>
                Main brand color for buttons and accents
              </FieldDescription>
              <ColorInput
                id={field.name}
                value={field.value}
                onChange={field.onChange}
              />
              {fieldState.error && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />

        <Controller
          name="secondaryColor"
          control={control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={field.name}>Secondary Color</FieldLabel>
              <FieldDescription>
                Complementary color for highlights
              </FieldDescription>
              <ColorInput
                id={field.name}
                value={field.value}
                onChange={field.onChange}
              />
              {fieldState.error && <FieldError errors={[fieldState.error]} />}
            </Field>
          )}
        />
      </div>

      {/* Tagline */}
      <Controller
        name="tagline"
        control={control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor={field.name}>Tagline (Optional)</FieldLabel>
            <FieldDescription>
              A short phrase that describes your brand or service
            </FieldDescription>
            <Textarea
              {...field}
              id={field.name}
              placeholder="e.g., Where beauty meets excellence"
              className="min-h-[80px] resize-none"
              maxLength={200}
              value={field.value || ''}
            />
            <div className="flex justify-between">
              {fieldState.error ? (
                <FieldError errors={[fieldState.error]} />
              ) : (
                <span />
              )}
              <span className="text-xs text-muted-foreground">
                {field.value?.length || 0}/200
              </span>
            </div>
          </Field>
        )}
      />

      <p className="text-xs text-muted-foreground">
        These settings will be used by the AI when generating ads, graphics, and
        other content for your business. You can update them anytime in your
        organization settings.
      </p>
    </FieldGroup>
  );
}
