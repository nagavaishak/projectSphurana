/**
 * FIXTURES — no API, no database, no persistence.
 *
 * This whole file is throwaway sample data for the form-template builder while
 * the unified form engine (docs/handoffs/portal.md §2.8) is still in its EXPAND
 * phase: the `form` table exists, nothing reads or writes it yet. When the
 * services and hooks land, delete this file and point the components at them —
 * the shapes below deliberately mirror `packages/database/src/schema/form.ts`
 * so that swap is a change of source, not of components.
 *
 * The store underneath is a module-level array with a `useSyncExternalStore`
 * subscription, so edits made in the editor show up in the list for the life of
 * the tab and vanish on reload. That is the point: it is a wireframe.
 */

import type { FormKind, IntakeFieldType } from '@borradh-workspace/labels';
import { useSyncExternalStore } from 'react';

/**
 * Whether a patient may see a submission of this template in the portal.
 * Mirrors `form_visibility`. A `note` is NEVER `patient` — the database says so
 * (`form_note_never_patient_visible`) and so does the editor, which does not
 * render the control at all for notes.
 */
export type FormVisibility = 'staff_only' | 'patient';

/** One question. Same shape as `IntakeFormField`, which `form.fields` reuses. */
export interface FormTemplateField {
  /**
   * STABLE key. Answers in `form_submission.answers` are keyed by it, so it is
   * minted once when the field is added and never reused, renumbered or
   * recomputed — not when the field is relabelled, not when it is reordered,
   * not when its type changes.
   */
  id: string;
  type: IntakeFieldType;
  label: string;
  required?: boolean;
  /** Only for `dropdown` / `single_select` / `multi_select`. */
  options?: string[];
  helpText?: string;
}

/** One template. Mirrors the `form` row minus the server-owned columns. */
export interface FormTemplate {
  id: string;
  kind: FormKind;
  name: string;
  description: string | null;
  fields: FormTemplateField[];
  requiresSignature: boolean;
  patientVisibility: FormVisibility;
  isActive: boolean;
}

/** Field types that carry a list of choices. Nothing else may have `options`. */
export const CHOICE_FIELD_TYPES: IntakeFieldType[] = [
  'dropdown',
  'single_select',
  'multi_select',
];

export const isChoiceField = (type: IntakeFieldType): boolean =>
  CHOICE_FIELD_TYPES.includes(type);

/** A heading, not an input: no answer, so no `required`, no options. */
export const isSectionField = (type: IntakeFieldType): boolean =>
  type === 'section';

/** Fields that hold an answer — everything except a section heading. */
export const isInputField = (type: IntakeFieldType): boolean =>
  !isSectionField(type);

// ── The sample templates ────────────────────────────────────────────────────

const SEED: FormTemplate[] = [
  {
    id: 'tpl-medical-history',
    kind: 'intake',
    name: 'Medical history',
    description: 'Collected before a first appointment.',
    fields: [
      { id: 'fld-mh-1', type: 'section', label: 'About you' },
      {
        id: 'fld-mh-2',
        type: 'short_text',
        label: 'GP practice',
        required: false,
      },
      {
        id: 'fld-mh-3',
        type: 'long_text',
        label: 'Current medications',
        helpText: 'Include dose and frequency where you know it.',
        required: true,
      },
      {
        id: 'fld-mh-4',
        type: 'multi_select',
        label: 'Do any of these apply to you?',
        options: ['Pregnant or breastfeeding', 'Diabetes', 'Keloid scarring'],
      },
      { id: 'fld-mh-5', type: 'date', label: 'Date of birth', required: true },
    ],
    requiresSignature: false,
    patientVisibility: 'patient',
    isActive: true,
  },
  {
    id: 'tpl-botulinum-consent',
    kind: 'consent',
    name: 'Botulinum toxin consent',
    description:
      'Risks, aftercare and the declaration the patient signs before treatment.',
    fields: [
      {
        id: 'fld-bc-1',
        type: 'checkbox',
        label: 'I have read and understood the risks explained to me.',
        required: true,
      },
      {
        id: 'fld-bc-2',
        type: 'single_select',
        label: 'Have you had this treatment before?',
        options: ['Yes', 'No'],
        required: true,
      },
      { id: 'fld-bc-3', type: 'signature', label: 'Signature', required: true },
    ],
    requiresSignature: true,
    patientVisibility: 'patient',
    isActive: true,
  },
  {
    id: 'tpl-consultation-note',
    kind: 'note',
    name: 'Consultation note (SOAP)',
    description: "The clinician's record of the consultation.",
    fields: [
      {
        id: 'fld-cn-1',
        type: 'long_text',
        label: 'Subjective',
        required: true,
      },
      { id: 'fld-cn-2', type: 'long_text', label: 'Objective' },
      {
        id: 'fld-cn-3',
        type: 'long_text',
        label: 'Assessment',
        required: true,
      },
      { id: 'fld-cn-4', type: 'long_text', label: 'Plan', required: true },
      { id: 'fld-cn-5', type: 'section', label: 'Follow-up' },
      { id: 'fld-cn-6', type: 'date', label: 'Review due' },
    ],
    requiresSignature: true,
    // A note is never patient-visible. Not a default someone may change — the
    // editor offers no control for it, and the CHECK constraint backs that up.
    patientVisibility: 'staff_only',
    isActive: true,
  },
  {
    id: 'tpl-patch-test',
    kind: 'intake',
    name: 'Patch test declaration',
    description: null,
    fields: [
      {
        id: 'fld-pt-1',
        type: 'date',
        label: 'Patch test date',
        required: true,
      },
      { id: 'fld-pt-2', type: 'checkbox', label: 'No reaction observed' },
    ],
    requiresSignature: false,
    patientVisibility: 'staff_only',
    isActive: false,
  },
];

// ── The store ───────────────────────────────────────────────────────────────

const clone = (template: FormTemplate): FormTemplate => ({
  ...template,
  fields: template.fields.map((field) => ({ ...field })),
});

let templates: FormTemplate[] = SEED.map(clone);

const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const snapshot = () => templates;

/** Every template, newest edit last. Re-renders when the store changes. */
export function useFormTemplates(): FormTemplate[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function getFormTemplate(id: string): FormTemplate | undefined {
  return templates.find((template) => template.id === id);
}

/** Insert or replace by id, so the editor's Save covers create and edit both. */
export function saveFormTemplate(template: FormTemplate): void {
  const next = clone(template);
  const index = templates.findIndex((existing) => existing.id === next.id);
  templates =
    index === -1
      ? [...templates, next]
      : templates.map((existing, i) => (i === index ? next : existing));
  emit();
}

export function deleteFormTemplate(id: string): void {
  templates = templates.filter((template) => template.id !== id);
  emit();
}

/** Mint an id for a new template or a new field. */
export function newId(prefix: 'tpl' | 'fld'): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
