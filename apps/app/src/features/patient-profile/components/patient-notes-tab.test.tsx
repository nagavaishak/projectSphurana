import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LeadProfileLead } from '../api';
import { PatientNotesTab } from './patient-notes-tab';

/**
 * ENG-791 — saving one note must not touch the other.
 *
 * The tab used to rebuild the WHOLE lead record from its `lead` prop with one
 * field swapped, which lost data two ways: "Save internal notes" sent
 * `portalNote: ''` (the wire encoding for "clear it"), and two saves in
 * succession each built their body from the same pre-save snapshot so the
 * second re-published the first's field at its old value. Both reported
 * success; the loss only showed after a reload.
 */
const put = vi.fn();

vi.mock('@borradh-workspace/api-client', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  apiClient: {
    put: (...args: unknown[]) => {
      put(...args);
      return Promise.resolve(makeLead());
    },
  },
}));

function makeLead(overrides: Partial<LeadProfileLead> = {}): LeadProfileLead {
  return {
    id: 'lead-1',
    firstName: 'Bobby',
    lastName: 'Tables',
    email: 'bob@x.io',
    phone: null,
    whatsapp: null,
    source: 'manual',
    status: 'new',
    tags: [],
    notes: null,
    portalNote: null,
    consentEmail: false,
    consentSms: false,
    consentVoice: false,
    createdAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** The body of the Nth `PUT /leads/:id`. */
const bodyOf = (call: number) =>
  put.mock.calls[call][1] as Record<string, unknown>;

describe('PatientNotesTab', () => {
  beforeEach(() => {
    put.mockClear();
  });

  it('sends ONLY the internal note when saving internal notes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PatientNotesTab lead={makeLead()} />);

    await user.type(
      screen.getByLabelText('Internal notes'),
      'Allergic to latex'
    );
    await user.click(screen.getByRole('button', { name: /save internal/i }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(bodyOf(0)).toEqual({ notes: 'Allergic to latex' });
    // The published customer note is not mentioned AT ALL. Sending it as ''
    // — which is what round-tripping `lead.portalNote ?? ''` produced — would
    // clear the note the customer sees.
    expect(bodyOf(0)).not.toHaveProperty('portalNote');
  });

  it('sends ONLY the customer note when saving the customer note', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PatientNotesTab lead={makeLead()} />);

    await user.type(
      screen.getByLabelText('Note for the customer'),
      'Arrive 10 minutes early'
    );
    await user.click(screen.getByRole('button', { name: /save customer/i }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(bodyOf(0)).toEqual({ portalNote: 'Arrive 10 minutes early' });
    expect(bodyOf(0)).not.toHaveProperty('notes');
  });

  it('preserves both values when the two saves are fired back-to-back', async () => {
    const user = userEvent.setup();
    // The exact reproduction from the issue: type into BOTH boxes, then save
    // one after the other without waiting for the profile to refetch.
    renderWithProviders(<PatientNotesTab lead={makeLead()} />);

    await user.type(screen.getByLabelText('Internal notes'), 'Internal');
    await user.type(screen.getByLabelText('Note for the customer'), 'Public');

    await user.click(screen.getByRole('button', { name: /save internal/i }));
    await user.click(screen.getByRole('button', { name: /save customer/i }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(2));

    // Neither body can reach the other's field, so there is nothing to race:
    // whichever order these land in, both values survive.
    expect(bodyOf(0)).toEqual({ notes: 'Internal' });
    expect(bodyOf(1)).toEqual({ portalNote: 'Public' });
  });

  it('can RETRACT a published customer note by clearing the box', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PatientNotesTab lead={makeLead({ portalNote: 'Old note' })} />
    );

    await user.clear(screen.getByLabelText('Note for the customer'));
    await user.click(screen.getByRole('button', { name: /save customer/i }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    // An explicit '' is the wire encoding for "clear it" — absent would mean
    // "leave unchanged" and the note could never be taken down.
    expect(bodyOf(0)).toEqual({ portalNote: '' });
  });

  it('does not discard an unsaved edit when the profile refetches', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(
      <PatientNotesTab lead={makeLead()} />
    );

    await user.type(screen.getByLabelText('Note for the customer'), 'Draft');

    // Saving the internal note invalidates the profile query, so a fresh lead
    // arrives with the customer note still unset. The unsaved "Draft" must
    // survive that — blindly re-syncing from the server value is how the typed
    // text disappeared before the user ever got to save it.
    rerender(<PatientNotesTab lead={makeLead({ notes: 'Internal' })} />);

    expect(screen.getByLabelText('Note for the customer')).toHaveValue('Draft');
  });
});
