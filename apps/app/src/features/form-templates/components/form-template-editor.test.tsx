import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders, screen, within } from '@/test/render';

/**
 * The two rules in this editor that a refactor could quietly break.
 *
 * 1. A `note` template offers NO patient-visibility control. Not a disabled
 *    one — the database forbids the value outright
 *    (`form_note_never_patient_visible`), so an affordance for it would be
 *    lying about what is possible.
 * 2. Reordering never renumbers a field `id`. Answers are keyed by it, so a
 *    reorder that re-mints ids re-points every stored answer.
 */

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

import type { FormTemplate } from '../fixtures';
import { FormFieldList } from './form-field-list';
import { FormTemplateEditor } from './form-template-editor';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}

const VISIBILITY_LABEL = /patient can see their submission/i;

const template = (over: Partial<FormTemplate> = {}): FormTemplate => ({
  description: null,
  fields: [{ id: 'fld-1', label: 'Subjective', type: 'long_text' }],
  id: 'tpl-1',
  isActive: true,
  kind: 'intake',
  name: 'A template',
  patientVisibility: 'staff_only',
  requiresSignature: false,
  ...over,
});

describe('FormTemplateEditor', () => {
  it('offers patient visibility for an intake template', () => {
    renderWithProviders(<FormTemplateEditor template={template()} />);

    expect(screen.getByText(VISIBILITY_LABEL)).toBeInTheDocument();
  });

  it('offers no patient-visibility control at all for a clinical note', () => {
    renderWithProviders(
      <FormTemplateEditor template={template({ kind: 'note' })} />
    );

    expect(screen.queryByText(VISIBILITY_LABEL)).not.toBeInTheDocument();
    expect(
      screen.getByText(/never visible to the patient/i)
    ).toBeInTheDocument();
  });
});

describe('FormFieldList', () => {
  const fields = [
    { id: 'fld-a', label: 'First', type: 'short_text' as const },
    { id: 'fld-b', label: 'Second', type: 'short_text' as const },
  ];

  it('reorders without changing any field id', async () => {
    const onChange = vi.fn();
    renderWithProviders(<FormFieldList fields={fields} onChange={onChange} />);

    await userEvent.click(
      screen.getByRole('button', { name: /move field 2 of 2 up/i })
    );

    expect(onChange).toHaveBeenCalledWith([
      { id: 'fld-b', label: 'Second', type: 'short_text' },
      { id: 'fld-a', label: 'First', type: 'short_text' },
    ]);
  });

  it('drops options when a choice field becomes a signature', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <FormFieldList
        fields={[
          {
            id: 'fld-c',
            label: 'Pick one',
            options: ['Yes', 'No'],
            type: 'single_select',
          },
        ]}
        onChange={onChange}
      />
    );

    await userEvent.click(
      screen.getByRole('combobox', { name: /field 1 type/i })
    );
    await userEvent.click(
      within(screen.getByRole('listbox')).getByText('Signature')
    );

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'fld-c',
        options: undefined,
        type: 'signature',
      }),
    ]);
  });
});
