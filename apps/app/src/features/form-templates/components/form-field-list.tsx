'use client';

import {
  type IntakeFieldType,
  intakeFieldTypeLabels,
  intakeFieldTypeValues,
} from '@borradh-workspace/labels';
import { ArrowDown, ArrowUp, ListPlus, PenLine, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  type FormTemplateField,
  isChoiceField,
  isInputField,
  isSectionField,
  newId,
} from '../fixtures';

interface FormFieldListProps {
  fields: FormTemplateField[];
  onChange: (fields: FormTemplateField[]) => void;
  disabled?: boolean;
}

/**
 * The ordered list of questions on a template.
 *
 * Reordering is buttons, not drag-and-drop: this list is edited on a phone as
 * often as a desktop, and a keyboard-reachable pair of arrows says the same
 * thing without a drag sensor. Moving a field NEVER touches its `id` — answers
 * in `form_submission.answers` are keyed by it, so a renumber on reorder would
 * silently re-point every stored answer at a different question.
 */
export function FormFieldList({
  fields,
  onChange,
  disabled = false,
}: FormFieldListProps) {
  const patch = (id: string, next: Partial<FormTemplateField>) =>
    onChange(
      fields.map((field) => (field.id === id ? { ...field, ...next } : field))
    );

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= fields.length) return;
    const next = [...fields];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  };

  const add = (type: IntakeFieldType) =>
    onChange([
      ...fields,
      {
        id: newId('fld'),
        type,
        label: '',
        // A section heading holds no answer, so it is never "required".
        ...(isInputField(type) ? { required: false } : {}),
        ...(isChoiceField(type) ? { options: [''] } : {}),
      },
    ]);

  return (
    <div className="space-y-3">
      {fields.length === 0 && (
        <p className="rounded-md border border-dashed p-6 text-center text-muted-foreground text-sm">
          No fields yet. Add the first question below.
        </p>
      )}

      {fields.map((field, index) => (
        <FieldRow
          disabled={disabled}
          field={field}
          index={index}
          key={field.id}
          onMoveDown={() => move(index, 1)}
          onMoveUp={() => move(index, -1)}
          onPatch={(next) => patch(field.id, next)}
          onRemove={() => onChange(fields.filter((f) => f.id !== field.id))}
          total={fields.length}
        />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={disabled}
          onClick={() => add('short_text')}
          type="button"
          variant="outline"
        >
          <PenLine className="size-4" />
          Add field
        </Button>
        <Button
          disabled={disabled}
          onClick={() => add('section')}
          type="button"
          variant="outline"
        >
          <ListPlus className="size-4" />
          Add section heading
        </Button>
      </div>
    </div>
  );
}

interface FieldRowProps {
  field: FormTemplateField;
  index: number;
  total: number;
  disabled: boolean;
  onPatch: (next: Partial<FormTemplateField>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

function FieldRow({
  field,
  index,
  total,
  disabled,
  onPatch,
  onRemove,
  onMoveUp,
  onMoveDown,
}: FieldRowProps) {
  const choice = isChoiceField(field.type);
  const section = isSectionField(field.type);
  const position = `${index + 1} of ${total}`;

  /**
   * Changing the type drops the apparatus the new type cannot carry: options
   * belong to the three choice types and nothing else, and a section heading
   * holds no answer so it cannot be required. Leaving stale keys behind is how
   * a `signature` ends up shipping a list of options nobody can see.
   */
  const changeType = (next: IntakeFieldType) =>
    onPatch({
      type: next,
      options: isChoiceField(next) ? (field.options ?? ['']) : undefined,
      required: isInputField(next) ? (field.required ?? false) : undefined,
    });

  return (
    <div
      className={cn(
        'space-y-3 rounded-md border p-3',
        section && 'border-dashed bg-muted/40'
      )}
    >
      <div className="flex items-start gap-2">
        <div className="flex flex-1 flex-col gap-2 sm:flex-row">
          <Input
            aria-label={`Field ${index + 1} label`}
            disabled={disabled}
            onChange={(event) => onPatch({ label: event.target.value })}
            placeholder={section ? 'Section heading' : 'Question label'}
            value={field.label}
          />
          <Select
            disabled={disabled}
            onValueChange={(next) => changeType(next as IntakeFieldType)}
            value={field.type}
          >
            <SelectTrigger
              aria-label={`Field ${index + 1} type`}
              className="sm:w-52"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {intakeFieldTypeValues.map((type) => (
                <SelectItem key={type} value={type}>
                  {intakeFieldTypeLabels[type]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex shrink-0 items-center">
          <Button
            aria-label={`Move field ${position} up`}
            disabled={disabled || index === 0}
            onClick={onMoveUp}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ArrowUp className="size-4" />
          </Button>
          <Button
            aria-label={`Move field ${position} down`}
            disabled={disabled || index === total - 1}
            onClick={onMoveDown}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ArrowDown className="size-4" />
          </Button>
          <Button
            aria-label={`Delete field ${position}`}
            disabled={disabled}
            onClick={onRemove}
            size="icon"
            type="button"
            variant="ghost"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      <Field>
        <FieldLabel htmlFor={`${field.id}-help`}>
          {section ? 'Guidance' : 'Help text'}
        </FieldLabel>
        <Input
          disabled={disabled}
          id={`${field.id}-help`}
          onChange={(event) => onPatch({ helpText: event.target.value })}
          placeholder="Optional — shown under the label"
          value={field.helpText ?? ''}
        />
      </Field>

      {choice && (
        <Field>
          <FieldLabel htmlFor={`${field.id}-options`}>
            Options (one per line)
          </FieldLabel>
          <Textarea
            disabled={disabled}
            id={`${field.id}-options`}
            onChange={(event) =>
              onPatch({ options: event.target.value.split('\n') })
            }
            placeholder={'Option 1\nOption 2'}
            value={(field.options ?? []).join('\n')}
          />
          <FieldDescription>
            Only dropdowns and choice fields have options.
          </FieldDescription>
        </Field>
      )}

      {section ? (
        <p className="text-muted-foreground text-sm">
          A heading, not a question — it takes no answer.
        </p>
      ) : (
        <div className="flex items-center gap-2">
          <Checkbox
            checked={field.required === true}
            disabled={disabled}
            id={`${field.id}-required`}
            onCheckedChange={(checked) =>
              onPatch({ required: checked === true })
            }
          />
          <Label className="text-sm" htmlFor={`${field.id}-required`}>
            Required
          </Label>
        </div>
      )}
    </div>
  );
}
