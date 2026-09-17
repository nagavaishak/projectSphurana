import { fireEvent, renderWithProviders, screen } from '@/test/render';
import type { PractitionerWithRelations } from '@borradh-workspace/api-client/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * PractitionerDialog — create + edit form behaviour, ported from the
 * practitioners CRUD E2E. Mocks the two mutation hooks so we assert the exact
 * payload the form submits (create with no id; edit threads the id), and that
 * empty name/email is a no-op. WageConfigForm (edit-only, pulls scheduling
 * hooks) is stubbed.
 */

const createPractitioner = vi.fn();
const updatePractitioner = vi.fn();

vi.mock('@/features/practitioners', () => ({
  useCreatePractitioner: () => ({ createPractitioner, isCreating: false }),
  useUpdatePractitioner: () => ({ updatePractitioner, isUpdating: false }),
}));

vi.mock('@/features/scheduling', () => ({
  WageConfigForm: () => <div>wage-config</div>,
}));

import { PractitionerDialog } from './practitioner-dialog';

const existing = {
  id: 'prac_1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  phone: null,
  title: 'Senior Therapist',
  bio: null,
} as unknown as PractitionerWithRelations;

describe('PractitionerDialog', () => {
  beforeEach(() => {
    createPractitioner.mockReset();
    updatePractitioner.mockReset();
  });

  it('creates a practitioner with the entered fields (no id)', () => {
    renderWithProviders(<PractitionerDialog open onOpenChange={() => {}} />);

    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Grace Hopper' },
    });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'grace@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(createPractitioner).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Grace Hopper',
        email: 'grace@example.com',
      })
    );
    expect(updatePractitioner).not.toHaveBeenCalled();
  });

  it('pre-fills in edit mode and threads the id on update', () => {
    renderWithProviders(
      <PractitionerDialog
        open
        onOpenChange={() => {}}
        practitioner={existing}
      />
    );

    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Ada Lovelace'
    );

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Lead Therapist' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));

    expect(updatePractitioner).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'prac_1', title: 'Lead Therapist' })
    );
    expect(createPractitioner).not.toHaveBeenCalled();
  });

  it('does not submit when name or email is empty', () => {
    renderWithProviders(<PractitionerDialog open onOpenChange={() => {}} />);

    // only name filled → still a no-op
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Nameless' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));

    expect(createPractitioner).not.toHaveBeenCalled();
  });
});
