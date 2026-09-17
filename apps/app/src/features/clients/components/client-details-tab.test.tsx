import { aLead } from '@/features/leads/contracts/base-lead';
import { renderWithProviders, screen } from '@/test/render';
import {
  type LeadDetail,
  fixture,
  leadDetailSchema,
  leadSchema,
} from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The edit form drives `useUpdateLead` → apiClient.put(`leads/:id`, input).
const put = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    put: (...args: unknown[]) => put(...args),
    delete: vi.fn(),
  },
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

// ClientDetailsTab uses useNavigate (delete redirect). Preserve the real module
// (its barrel imports pull createFileRoute/Link) and override only useNavigate.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/customers' } }),
}));

// Radix Select (Source/Status) sets up a ResizeObserver on render.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import { ClientDetailsTab } from './client-details-tab';

// A schema-validated `leadDetail` projection (atom + `sourceLeadForm` join),
// built through `fixture(leadDetailSchema, …)` so the fixture can't drift from
// the contract the edit form is typed against.
function makeLead(overrides: Partial<LeadDetail> = {}): LeadDetail {
  return fixture(leadDetailSchema, {
    ...aLead({
      id: 'lead-1',
      firstName: 'Bob',
      lastName: 'Jones',
      email: 'bob@x.io',
      source: 'manual',
      status: 'new',
      tags: [],
      consentEmail: false,
      consentSms: false,
      consentVoice: false,
    }),
    sourceLeadForm: null,
    ...overrides,
  });
}

describe('ClientDetailsTab (edit client form)', () => {
  beforeEach(() => {
    put.mockResolvedValue({ id: 'lead-1' });
  });

  it('pre-fills fields from the loaded lead', () => {
    renderWithProviders(<ClientDetailsTab lead={makeLead()} />);

    expect(screen.getByLabelText(/first name/i)).toHaveValue('Bob');
    expect(screen.getByLabelText('Last Name')).toHaveValue('Jones');
    expect(screen.getByPlaceholderText('johndoe@example.com')).toHaveValue(
      'bob@x.io'
    );
  });

  it('blocks save and shows an inline error when first name is cleared', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientDetailsTab lead={makeLead()} />);

    await user.clear(screen.getByLabelText(/first name/i));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('First name is required')).toBeVisible();
    expect(put).not.toHaveBeenCalled();
  });

  it('gates saving on email format: a malformed email blocks the put, a valid one lets it through', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientDetailsTab lead={makeLead()} />);

    const email = screen.getByPlaceholderText('johndoe@example.com');
    await user.clear(email);
    await user.type(email, 'nope');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    // The schema's `.email()` rule rejects the value, so the mutation never runs.
    await new Promise((r) => setTimeout(r, 50));
    expect(put).not.toHaveBeenCalled();

    // Correcting the email unblocks the save.
    await user.clear(email);
    await user.type(email, 'ok@x.io');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
  });

  it('sends the updated payload to PUT /leads/:id exactly once', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ClientDetailsTab lead={makeLead()} />);

    const first = screen.getByLabelText(/first name/i);
    await user.clear(first);
    await user.type(first, 'Bobby');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    // The mutation puts the payload AND the response schema (report-mode parse).
    expect(put).toHaveBeenCalledWith(
      'leads/lead-1',
      {
        firstName: 'Bobby',
        lastName: 'Jones',
        email: 'bob@x.io',
        phone: undefined,
        whatsapp: undefined,
        source: 'manual',
        status: 'new',
        tags: [],
        // Sent as '' rather than dropped: this is a free-text box the user can
        // EMPTY, and `undefined` means "leave unchanged" on the wire — which
        // would make clearing the note impossible while still reporting
        // "Client updated successfully". `undefined` is reserved for the
        // format-constrained fields above (`phone`, `whatsapp`), where a blank
        // box means "not editing this".
        notes: '',
        // `portalNote` is ABSENT here, not empty — this form does not edit the
        // published customer note (the profile's Notes tab does), so it must
        // not mention it on the wire. An explicit '' would CLEAR a note the
        // clinic had published (ENG-791).
        consentEmail: false,
        consentSms: false,
        consentVoice: false,
      },
      { schema: leadSchema }
    );
  });

  it('surfaces a server error via toast and keeps the form mounted', async () => {
    put.mockRejectedValue(new Error('Update failed'));
    const user = userEvent.setup();
    renderWithProviders(<ClientDetailsTab lead={makeLead()} />);

    const first = screen.getByLabelText(/first name/i);
    await user.clear(first);
    await user.type(first, 'Bobby');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Update failed')
    );
    expect(screen.getByLabelText(/first name/i)).toBeVisible();
  });

  it('disables save and shows a pending label while in flight', async () => {
    let resolve!: (v: unknown) => void;
    put.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    const user = userEvent.setup();
    renderWithProviders(<ClientDetailsTab lead={makeLead()} />);

    const first = screen.getByLabelText(/first name/i);
    await user.clear(first);
    await user.type(first, 'Bobby');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    const pending = await screen.findByRole('button', { name: /saving/i });
    expect(pending).toBeDisabled();

    resolve({ id: 'lead-1' });
  });
});
