import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { useState } from 'react';
import { Controller, type UseFormReturn } from 'react-hook-form';

interface Step8CredibilityProps {
  // biome-ignore lint/suspicious/noExplicitAny: Form type flexibility needed
  form: UseFormReturn<any>;
}

const CUSTOM_VALUE = 'custom';

const DEFAULT_CREDIBILITY_LINES = [
  'Trusted by hundreds of happy clients',
  'Award-winning team of specialists',
  'Over 10 years of professional experience',
  'Industry certified and fully insured',
  '5-star rated on Google Reviews',
];

/**
 * Step 8: Credibility
 * Choose one credibility line to use in ads.
 * Displays AI-suggested lines as a vertical radio list with inline editing.
 * Selecting a suggestion makes it editable; a custom input is also available.
 */
export function Step8Credibility({ form }: Step8CredibilityProps) {
  const analysisLines: string[] = form.watch('suggestedCredibilityLines') || [];
  const suggestedLines =
    analysisLines.length > 0 ? analysisLines : DEFAULT_CREDIBILITY_LINES;

  // Track which radio item is selected: index for suggestions, 'custom' for custom input
  const [selectedItem, setSelectedItem] = useState<string | null>(null);

  return (
    <FieldGroup className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">
          Choose one credibility line to use in your ads
        </h1>
        <p className="text-muted-foreground">
          Used in credibility and authority ads
        </p>
      </div>

      {/* Radio List of Suggested Credibility Lines */}
      <Controller
        name="credibilityLine"
        control={form.control}
        render={({ field, fieldState }) => (
          <>
            {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
            {suggestedLines.length > 0 ? (
              <RadioGroup
                value={selectedItem ?? ''}
                onValueChange={(value) => {
                  // Skip if re-selecting the same item (prevents resetting edited text)
                  if (value === selectedItem) return;
                  setSelectedItem(value);
                  if (value !== CUSTOM_VALUE) {
                    const index = Number(value);
                    field.onChange(suggestedLines[index]);
                  } else {
                    field.onChange('');
                  }
                }}
                className="gap-0"
              >
                {suggestedLines.map((line, index) => {
                  const isSelected = selectedItem === String(index);
                  return (
                    <label
                      key={index}
                      htmlFor={`credibility-${index}`}
                      className="flex cursor-pointer items-center gap-3 border-b px-1 py-4 transition-colors hover:bg-muted/50 last:border-b-0"
                      onClick={(e) => {
                        // Prevent the label from re-activating the radio
                        // when clicking inside the editable Input
                        if (
                          isSelected &&
                          e.target instanceof HTMLInputElement &&
                          e.target.type !== 'radio'
                        ) {
                          e.preventDefault();
                        }
                      }}
                      onKeyDown={() => {}}
                    >
                      <RadioGroupItem
                        value={String(index)}
                        id={`credibility-${index}`}
                        className="shrink-0"
                      />
                      {isSelected ? (
                        <Input
                          value={field.value || ''}
                          onChange={(e) => field.onChange(e.target.value)}
                          className="h-auto border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                        />
                      ) : (
                        <span className="text-sm">{line}</span>
                      )}
                    </label>
                  );
                })}

                {/* Custom Credibility Line */}
                <label
                  htmlFor="credibility-custom"
                  className="flex cursor-pointer items-center gap-3 px-1 py-4 transition-colors hover:bg-muted/50"
                  onClick={(e) => {
                    if (
                      selectedItem === CUSTOM_VALUE &&
                      e.target instanceof HTMLInputElement &&
                      e.target.type !== 'radio'
                    ) {
                      e.preventDefault();
                    }
                  }}
                  onKeyDown={() => {}}
                >
                  <RadioGroupItem
                    value={CUSTOM_VALUE}
                    id="credibility-custom"
                    className="shrink-0"
                  />
                  {selectedItem === CUSTOM_VALUE ? (
                    <Input
                      value={field.value || ''}
                      onChange={(e) => field.onChange(e.target.value)}
                      placeholder="Write your own credibility line"
                      className="h-auto border-none bg-transparent p-0 text-sm shadow-none focus-visible:ring-0"
                    />
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      Write your own credibility line
                    </span>
                  )}
                </label>
              </RadioGroup>
            ) : (
              <Field className="flex flex-col gap-2">
                <FieldLabel className="text-secondary-foreground text-sm font-medium">
                  Credibility Line
                </FieldLabel>
                <Input
                  value={field.value || ''}
                  onChange={(e) => field.onChange(e.target.value)}
                  placeholder="Write your own credibility line"
                />
              </Field>
            )}
          </>
        )}
      />
    </FieldGroup>
  );
}
