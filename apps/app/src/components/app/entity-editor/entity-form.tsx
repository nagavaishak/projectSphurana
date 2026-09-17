'use client';

import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import type {
  EntityField,
  EntityFieldContext,
  EntityFormBlock,
  EntityFormSection,
} from './entity-form-types';

/**
 * Renders one config-declared section. Knows nothing about services, products
 * or any other entity — it walks blocks → rows → fields.
 */
export function EntityFormSectionRenderer({
  section,
  ctx,
}: {
  section: EntityFormSection;
  ctx: EntityFieldContext;
}) {
  const blocks = section.blocks.filter((b) => !b.hidden?.(ctx.values));

  return (
    <>
      {blocks.map((block, index) => (
        <EntityFormBlockRenderer
          block={block}
          ctx={ctx}
          key={block.title ?? `block-${index}`}
        />
      ))}
    </>
  );
}

function EntityFormBlockRenderer({
  block,
  ctx,
}: {
  block: EntityFormBlock;
  ctx: EntityFieldContext;
}) {
  // Figma node 3105:8141: 4px under the block heading, 14px to the first
  // field, 16px between fields, 32px between blocks.
  return (
    <section className="border-b py-8 first:pt-0 last:border-b-0 last:pb-0">
      {block.title && (
        <h2 className="pb-1 font-semibold text-xl leading-7">{block.title}</h2>
      )}
      <div className="mt-[14px] space-y-4">
        {block.rows.map((row, rowIndex) => {
          const visible = row.filter((f) => !f.hidden?.(ctx.values));
          if (visible.length === 0) return null;
          return (
            <div
              className={cn(
                'grid gap-4',
                // A row of N fields is N columns on desktop and one on mobile —
                // the "Measure | Amount" and "Duration | Pricing Type | Price"
                // rows in the design.
                visible.length === 2 && 'sm:grid-cols-2',
                visible.length === 3 && 'sm:grid-cols-3',
                visible.length >= 4 && 'sm:grid-cols-4'
              )}
              key={`row-${rowIndex}`}
            >
              {visible.map((field) => (
                <EntityFieldRenderer ctx={ctx} field={field} key={field.name} />
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EntityFieldRenderer({
  field,
  ctx,
}: {
  field: EntityField;
  ctx: EntityFieldContext;
}) {
  const { values, errors, setValue, disabled: formDisabled } = ctx;
  const error = errors[field.name];
  const value = values[field.name];
  const id = `entity-field-${field.name}`;

  if (field.kind === 'custom') {
    return <>{field.render(ctx)}</>;
  }

  // A saving form disables everything; a field can additionally rule itself out
  // based on the values above it.
  const disabled = formDisabled || Boolean(field.disabled?.(values));

  if (field.kind === 'checkbox') {
    return (
      <Field data-invalid={Boolean(error)} orientation="horizontal">
        <Checkbox
          checked={Boolean(value)}
          disabled={disabled}
          id={id}
          onCheckedChange={(checked) => setValue(field.name, checked === true)}
        />
        {field.label && <FieldLabel htmlFor={id}>{field.label}</FieldLabel>}
        {error && <FieldMessage>{error}</FieldMessage>}
      </Field>
    );
  }

  return (
    <Field data-invalid={Boolean(error)}>
      {field.label && <FieldLabel htmlFor={id}>{field.label}</FieldLabel>}

      {field.kind === 'textarea' && (
        <Textarea
          aria-invalid={Boolean(error)}
          disabled={disabled}
          id={id}
          maxLength={field.maxLength}
          onChange={(event) => setValue(field.name, event.target.value)}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
        />
      )}

      {field.kind === 'text' && (
        <Input
          aria-invalid={Boolean(error)}
          disabled={disabled}
          id={id}
          maxLength={field.maxLength}
          onChange={(event) => setValue(field.name, event.target.value)}
          placeholder={field.placeholder}
          value={typeof value === 'string' ? value : ''}
        />
      )}

      {field.kind === 'number' && (
        <Input
          aria-invalid={Boolean(error)}
          disabled={disabled}
          id={id}
          inputMode="decimal"
          max={field.max}
          min={field.min}
          onChange={(event) => setValue(field.name, event.target.value)}
          placeholder={field.placeholder}
          type="number"
          value={
            typeof value === 'string' || typeof value === 'number'
              ? String(value)
              : ''
          }
        />
      )}

      {field.kind === 'select' && (
        <Select
          disabled={disabled}
          onValueChange={(next) => setValue(field.name, next)}
          value={typeof value === 'string' ? value : undefined}
        >
          <SelectTrigger aria-invalid={Boolean(error)} id={id}>
            <SelectValue placeholder={field.placeholder} />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {field.description && !error && (
        <FieldDescription>{field.description}</FieldDescription>
      )}
      {error && <FieldMessage>{error}</FieldMessage>}
    </Field>
  );
}

/**
 * `FieldError` from the Field system takes react-hook-form error objects; these
 * configs carry plain strings, so this renders the same affordance without
 * forcing every feature to fabricate an error object.
 */
function FieldMessage({ children }: { children: string }) {
  return (
    <p className="text-destructive text-sm" role="alert">
      {children}
    </p>
  );
}
