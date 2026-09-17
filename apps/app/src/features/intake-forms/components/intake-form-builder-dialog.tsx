'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
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
import {
  useCreateIntakeForm,
  useUpdateIntakeForm,
} from '@/features/intake-forms/api';
import type {
  IntakeForm,
  IntakeFormFieldInput,
} from '@/features/intake-forms/api/types';
import {
  type IntakeFieldType,
  intakeFieldTypeLabels,
  intakeFieldTypeValues,
} from '@borradh-workspace/labels';
import { GripVerticalIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useState } from 'react';

interface IntakeFormBuilderDialogProps {
  /** When set, the dialog edits this form; otherwise it creates a new one. */
  form?: IntakeForm | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CHOICE_TYPES: IntakeFieldType[] = [
  'dropdown',
  'single_select',
  'multi_select',
];

const newField = (): IntakeFormFieldInput => ({
  id: crypto.randomUUID(),
  type: 'short_text',
  label: '',
  required: false,
});

/**
 * The form builder — name, description, and an ordered list of questions. Each
 * question picks a type (from the intake field-type labels), a label, whether
 * it's required, and — for choice types — its options. Saves via create or
 * update depending on whether an existing form was passed in.
 */
export function IntakeFormBuilderDialog({
  form,
  open,
  onOpenChange,
}: IntakeFormBuilderDialogProps) {
  const isEdit = !!form;
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fields, setFields] = useState<IntakeFormFieldInput[]>([]);

  // Reset the working copy whenever the dialog opens or the target form changes.
  useEffect(() => {
    if (!open) return;
    setName(form?.name ?? '');
    setDescription(form?.description ?? '');
    setFields(form?.fields.map((f) => ({ ...f })) ?? [newField()]);
  }, [open, form]);

  const { createForm, isCreating } = useCreateIntakeForm({
    onSuccess: () => onOpenChange(false),
  });
  const { updateForm, isUpdating } = useUpdateIntakeForm({
    onSuccess: () => onOpenChange(false),
  });
  const isSaving = isCreating || isUpdating;

  const patchField = (id: string, patch: Partial<IntakeFormFieldInput>) =>
    setFields((prev) =>
      prev.map((f) => (f.id === id ? { ...f, ...patch } : f))
    );

  const removeField = (id: string) =>
    setFields((prev) => prev.filter((f) => f.id !== id));

  const handleSave = () => {
    // Normalise: choice fields keep their options; others drop them.
    const cleaned = fields.map((f) => ({
      ...f,
      options: CHOICE_TYPES.includes(f.type)
        ? (f.options ?? []).map((o) => o.trim()).filter(Boolean)
        : undefined,
    }));

    if (isEdit && form) {
      updateForm({
        id: form.id,
        name: name.trim(),
        description: description.trim() || null,
        fields: cleaned,
      });
    } else {
      createForm({
        name: name.trim(),
        description: description.trim() || undefined,
        fields: cleaned,
      });
    }
  };

  const canSave =
    name.trim().length > 0 &&
    fields.length > 0 &&
    fields.every((f) => f.label.trim().length > 0) &&
    fields.every(
      (f) =>
        !CHOICE_TYPES.includes(f.type) ||
        (f.options ?? []).some((o) => o.trim().length > 0)
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit form' : 'New intake form'}</DialogTitle>
          <DialogDescription>
            Build the questions a client answers before their appointment.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="intake-name">Form name</FieldLabel>
            <Input
              id="intake-name"
              value={name}
              placeholder="e.g. Medical history"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="intake-description">
              Description (optional)
            </FieldLabel>
            <Textarea
              id="intake-description"
              value={description}
              placeholder="Shown to the client at the top of the form"
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-sm">Questions</h3>
            </div>

            {fields.map((field, index) => (
              <IntakeFieldEditor
                key={field.id}
                field={field}
                index={index}
                onChange={(patch) => patchField(field.id, patch)}
                onRemove={() => removeField(field.id)}
                canRemove={fields.length > 1}
              />
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setFields((prev) => [...prev, newField()])}
            >
              <PlusIcon className="size-4" />
              Add question
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave || isSaving}>
            {isSaving ? 'Saving…' : isEdit ? 'Save changes' : 'Create form'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface IntakeFieldEditorProps {
  field: IntakeFormFieldInput;
  index: number;
  onChange: (patch: Partial<IntakeFormFieldInput>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function IntakeFieldEditor({
  field,
  index,
  onChange,
  onRemove,
  canRemove,
}: IntakeFieldEditorProps) {
  const isChoice = CHOICE_TYPES.includes(field.type);
  const isSection = field.type === 'section';

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-start gap-2">
        <GripVerticalIcon className="mt-2 size-4 shrink-0 text-muted-foreground" />
        <div className="flex-1 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label={`Question ${index + 1} label`}
              value={field.label}
              placeholder={isSection ? 'Section heading' : 'Question label'}
              onChange={(e) => onChange({ label: e.target.value })}
            />
            <Select
              value={field.type}
              onValueChange={(v) => onChange({ type: v as IntakeFieldType })}
            >
              <SelectTrigger className="sm:w-48">
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

          {isChoice && (
            <Field>
              <FieldLabel htmlFor={`${field.id}-options`}>
                Options (one per line)
              </FieldLabel>
              <Textarea
                id={`${field.id}-options`}
                value={(field.options ?? []).join('\n')}
                placeholder={'Option 1\nOption 2'}
                onChange={(e) =>
                  onChange({ options: e.target.value.split('\n') })
                }
              />
            </Field>
          )}

          {!isSection && (
            <div className="flex items-center gap-2">
              <Checkbox
                id={`${field.id}-required`}
                checked={field.required === true}
                onCheckedChange={(c) => onChange({ required: c === true })}
              />
              <Label htmlFor={`${field.id}-required`} className="text-sm">
                Required
              </Label>
            </div>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
          disabled={!canRemove}
          aria-label={`Remove question ${index + 1}`}
        >
          <Trash2Icon className="size-4" />
        </Button>
      </div>
    </div>
  );
}
