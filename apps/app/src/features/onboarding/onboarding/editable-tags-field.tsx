import {
  Tags,
  TagsContent,
  TagsEmpty,
  TagsGroup,
  TagsInput,
  TagsItem,
  TagsList,
  TagsTrigger,
  TagsValue,
} from '@/components/kibo-ui/tags';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { cn } from '@/lib/utils';
import { useState } from 'react';

/**
 * Editable Tags field backed by a string array in the form
 */
export function EditableTagsField({
  label,
  description,
  values,
  onChange,
  placeholder,
  suggestions,
  invalid,
  error,
}: {
  label: string;
  description?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  invalid?: boolean;
  error?: string;
}) {
  const [inputValue, setInputValue] = useState('');

  const handleAddTag = (tag: string) => {
    const trimmed = tag.trim();
    if (trimmed && !values.includes(trimmed)) {
      onChange([...values, trimmed]);
    }
    setInputValue('');
  };

  const handleRemoveTag = (tag: string) => {
    onChange(values.filter((v) => v !== tag));
  };

  // Filter suggestions to exclude already-selected values
  const availableSuggestions = (suggestions ?? []).filter(
    (s) => !values.includes(s)
  );

  return (
    <Field className="flex flex-col gap-2" data-invalid={invalid}>
      <FieldLabel className="text-secondary-foreground text-sm font-medium">
        {label}
      </FieldLabel>
      {description && <FieldDescription>{description}</FieldDescription>}
      <Tags>
        <TagsTrigger
          className={cn('min-h-[42px]', invalid && 'border-destructive')}
          placeholder={placeholder ?? 'Select a tag...'}
        >
          {values.map((tag) => (
            <TagsValue key={tag} onRemove={() => handleRemoveTag(tag)}>
              {tag}
            </TagsValue>
          ))}
        </TagsTrigger>
        <TagsContent>
          <TagsInput
            placeholder={placeholder ?? 'Search or add...'}
            value={inputValue}
            onValueChange={setInputValue}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAddTag(inputValue);
              }
            }}
          />
          <TagsList>
            <TagsEmpty>
              {inputValue.trim() ? (
                <button
                  type="button"
                  className="w-full cursor-pointer px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onClick={() => handleAddTag(inputValue)}
                >
                  Add &ldquo;{inputValue.trim()}&rdquo;
                </button>
              ) : (
                `Type to add${label ? ` a ${label.toLowerCase().replace(/s$/, '')}` : ''}`
              )}
            </TagsEmpty>
            {availableSuggestions.length > 0 && (
              <TagsGroup>
                {availableSuggestions.map((suggestion) => (
                  <TagsItem
                    key={suggestion}
                    value={suggestion}
                    onSelect={() => handleAddTag(suggestion)}
                  >
                    {suggestion}
                  </TagsItem>
                ))}
              </TagsGroup>
            )}
          </TagsList>
        </TagsContent>
      </Tags>
      {invalid && error && <FieldError errors={[{ message: error }]} />}
    </Field>
  );
}
