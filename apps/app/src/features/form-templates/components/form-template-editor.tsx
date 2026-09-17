'use client';

import {
  type FormKind,
  formKindLabels,
  formKindValues,
} from '@borradh-workspace/labels';
import { useNavigate } from '@tanstack/react-router';
import { FileText, ListChecks } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { EntityFormPage } from '@/components/app/entity-editor';
import type {
  EntityFormConfig,
  EntityFormErrors,
  EntityFormValues,
} from '@/components/app/entity-editor';

import {
  type FormTemplate,
  type FormTemplateField,
  type FormVisibility,
  isChoiceField,
  newId,
  saveFormTemplate,
} from '../fixtures';
import { FormFieldList } from './form-field-list';

const LIST_PATH = '/dashboard/settings/form-templates' as const;

interface FormTemplateEditorProps {
  /** Null → create mode. */
  template: FormTemplate | null;
}

/**
 * Create/edit one template, on the shared `EntityFormPage`.
 *
 * Two sections because they are two jobs: what the template IS (Details) and
 * what it ASKS (Fields). The field list is a `custom` field — the escape hatch
 * the editor provides for rich controls — so it keeps its own markup while the
 * page chrome, section nav, save bar and mobile layout stay shared.
 *
 * WRITES TO FIXTURES. There is no API for `form` yet; see `../fixtures.ts`.
 */
export function FormTemplateEditor({ template }: FormTemplateEditorProps) {
  const navigate = useNavigate();
  const isEdit = Boolean(template);

  const [values, setValues] = useState<EntityFormValues>(() => ({
    description: template?.description ?? '',
    fields: template?.fields ?? [],
    isActive: template?.isActive ?? true,
    kind: template?.kind ?? 'intake',
    name: template?.name ?? '',
    patientVisibility: template?.patientVisibility ?? 'staff_only',
    requiresSignature: template?.requiresSignature ?? false,
  }));
  const [errors, setErrors] = useState<EntityFormErrors>({});

  const setValue = useCallback((name: string, value: unknown) => {
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      // A clinical note is NEVER patient-visible — the database enforces it
      // (`form_note_never_patient_visible`) and the control disappears below,
      // so switching an already-shared consent form over to `note` must also
      // put the stored value back rather than leaving an invalid row behind.
      if (name === 'kind' && value === 'note') {
        next.patientVisibility = 'staff_only';
      }
      return next;
    });
    setErrors((prev) => ({ ...prev, [name]: undefined }));
  }, []);

  const goToList = () => void navigate({ to: LIST_PATH });

  const config: EntityFormConfig = useMemo(
    () => ({
      sections: [
        {
          blocks: [
            {
              rows: [
                [
                  {
                    kind: 'text',
                    label: 'Template name',
                    name: 'name',
                    placeholder: 'e.g. Medical history',
                  },
                  {
                    kind: 'select',
                    label: 'Type',
                    name: 'kind',
                    options: formKindValues.map((value) => ({
                      label: formKindLabels[value],
                      value,
                    })),
                  },
                ],
                [
                  {
                    description:
                      'Shown at the top of the form, above the first question.',
                    kind: 'textarea',
                    label: 'Description',
                    name: 'description',
                  },
                ],
              ],
              title: 'Details',
            },
            {
              rows: [
                [
                  {
                    description:
                      'The form ends with a signature the person completing it draws.',
                    kind: 'checkbox',
                    label: 'Requires a signature',
                    name: 'requiresSignature',
                  },
                ],
                [
                  {
                    description:
                      'Inactive templates stay readable on past submissions but cannot be sent.',
                    kind: 'checkbox',
                    label: 'Active',
                    name: 'isActive',
                  },
                ],
                [
                  {
                    // Notes have no visibility control AT ALL — not a disabled
                    // one. An affordance that is present but greyed reads as
                    // "ask an admin"; this is not a permission, it is a rule.
                    hidden: (current) => current.kind === 'note',
                    kind: 'select',
                    label: 'Patient can see their submission',
                    name: 'patientVisibility',
                    options: [
                      { label: 'No — staff only', value: 'staff_only' },
                      {
                        label: 'Yes — visible in the portal',
                        value: 'patient',
                      },
                    ],
                  },
                  {
                    hidden: (current) => current.kind !== 'note',
                    kind: 'custom',
                    name: 'noteVisibilityNotice',
                    render: () => (
                      <p className="text-muted-foreground text-sm">
                        Clinical notes are never visible to the patient. What a
                        patient receives is a treatment plan, written separately
                        from the note.
                      </p>
                    ),
                  },
                ],
              ],
              title: 'Behaviour',
            },
          ],
          icon: FileText,
          id: 'details',
          label: 'Details',
        },
        {
          blocks: [
            {
              rows: [
                [
                  {
                    kind: 'custom',
                    name: 'fields',
                    render: (ctx) => (
                      <FormFieldList
                        disabled={ctx.disabled}
                        fields={
                          (ctx.values.fields as FormTemplateField[]) ?? []
                        }
                        onChange={(next) => ctx.setValue('fields', next)}
                      />
                    ),
                  },
                ],
              ],
              title: 'Fields',
            },
          ],
          icon: ListChecks,
          id: 'fields',
          label: 'Fields',
        },
      ],
      title: (edit) => (edit ? 'Edit template' : 'New template'),
    }),
    []
  );

  const handleSave = (): string | undefined => {
    const name = String(values.name ?? '').trim();
    const fields = (values.fields as FormTemplateField[]) ?? [];

    if (!name) {
      setErrors({ name: 'Give the template a name' });
      return 'details';
    }

    if (fields.length === 0) {
      toast.error('Add at least one field');
      return 'fields';
    }
    if (fields.some((field) => !field.label.trim())) {
      toast.error('Every field needs a label');
      return 'fields';
    }
    if (
      fields.some(
        (field) =>
          isChoiceField(field.type) &&
          !(field.options ?? []).some((option) => option.trim())
      )
    ) {
      toast.error('Choice fields need at least one option');
      return 'fields';
    }

    const kind = values.kind as FormKind;
    const saved: FormTemplate = {
      description: String(values.description ?? '').trim() || null,
      // The field `id` is carried through untouched — answers are keyed by it.
      fields: fields.map((field) => ({
        ...field,
        helpText: field.helpText?.trim() || undefined,
        label: field.label.trim(),
        options: isChoiceField(field.type)
          ? (field.options ?? []).map((o) => o.trim()).filter(Boolean)
          : undefined,
      })),
      id: template?.id ?? newId('tpl'),
      isActive: values.isActive === true,
      kind,
      name,
      // Belt and braces against the CHECK constraint: whatever the form state
      // says, a note saves as staff-only.
      patientVisibility:
        kind === 'note'
          ? 'staff_only'
          : ((values.patientVisibility as FormVisibility) ?? 'staff_only'),
      requiresSignature: values.requiresSignature === true,
    };

    saveFormTemplate(saved);
    toast.success(isEdit ? 'Template saved' : 'Template created');
    goToList();
    return undefined;
  };

  return (
    <EntityFormPage
      config={config}
      errors={errors}
      isEdit={isEdit}
      onCancel={goToList}
      onSave={handleSave}
      setValue={setValue}
      values={values}
    />
  );
}
