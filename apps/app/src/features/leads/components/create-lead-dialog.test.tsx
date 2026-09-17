import { aLead } from '@/features/leads/contracts/base-lead';
import { renderWithProviders, screen, within } from '@/test/render';
import { leadSchema } from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The create form drives `useCreateLead` → apiClient.post('leads', input).
// Mock the api-client so React Query resolves our fixture exactly as prod, and
// mock sonner so we can assert the error toast without a real toaster.
const post = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    post: (...args: unknown[]) => post(...args),
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

// The create hook fires a PostHog event on success — stub the provider so the
// import graph doesn't pull analytics into the test.
vi.mock('@/components/providers', () => ({
  trackEvent: vi.fn(),
}));

// Radix Select (the Source field) sets up a ResizeObserver on render — jsdom
// has none, so provide a no-op.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import { CreateLeadDialog } from './create-lead-dialog';

/** Open the dialog from its trigger and return the dialog scope. */
async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /create lead/i }));
  const dialog = await screen.findByRole('dialog');
  return within(dialog);
}

describe('CreateLeadDialog (create client form)', () => {
  beforeEach(() => {
    // The created-lead response is a schema-validated lead atom.
    post.mockResolvedValue(aLead({ id: 'new-lead' }));
  });

  it('renders every field with its label', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateLeadDialog />);
    const dialog = await openDialog(user);

    expect(
      dialog.getByRole('heading', { name: 'Create New Client' })
    ).toBeVisible();
    expect(dialog.getByLabelText(/first name/i)).toBeVisible();
    expect(dialog.getByLabelText('Last Name')).toBeVisible();
    expect(dialog.getByPlaceholderText('johndoe@example.com')).toBeVisible();
    expect(dialog.getByLabelText('Phone')).toBeVisible();
    expect(dialog.getByLabelText('WhatsApp')).toBeVisible();
    expect(dialog.getByLabelText('Notes')).toBeVisible();
    expect(dialog.getByText(/source/i)).toBeVisible();
    expect(dialog.getByText('Contact Consent')).toBeVisible();
  });

  it('blocks submit and shows an inline error when the required first name is empty', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateLeadDialog />);
    const dialog = await openDialog(user);

    await user.click(dialog.getByRole('button', { name: 'Create Lead' }));

    expect(await dialog.findByText('First name is required')).toBeVisible();
    expect(post).not.toHaveBeenCalled();
  });

  it('gates submission on email format: a malformed email blocks the post, a valid one lets it through', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateLeadDialog />);
    const dialog = await openDialog(user);

    await user.type(dialog.getByLabelText(/first name/i), 'Ada');
    const email = dialog.getByPlaceholderText('johndoe@example.com');
    await user.type(email, 'not-an-email');
    await user.click(dialog.getByRole('button', { name: 'Create Lead' }));

    // The schema's `.email()` rule rejects the value, so the mutation never runs.
    await new Promise((r) => setTimeout(r, 50));
    expect(post).not.toHaveBeenCalled();

    // Correcting the email unblocks the submit.
    await user.clear(email);
    await user.type(email, 'ada@x.io');
    await user.click(dialog.getByRole('button', { name: 'Create Lead' }));
    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  });

  it('posts the exact payload once for a valid submit', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateLeadDialog />);
    const dialog = await openDialog(user);

    await user.type(dialog.getByLabelText(/first name/i), 'Ada');
    await user.type(dialog.getByLabelText('Last Name'), 'Lovelace');
    await user.type(
      dialog.getByPlaceholderText('johndoe@example.com'),
      'ada@x.io'
    );
    await user.click(dialog.getByRole('button', { name: 'Create Lead' }));

    await vi.waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    // The mutation posts the payload AND the response schema (report-mode parse).
    expect(post).toHaveBeenCalledWith(
      'leads',
      {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@x.io',
        // Untouched optional inputs are ABSENT, not ''. The contract requires a
        // well-formed value when a key is present, so a blank one is a 400 the
        // moment the field gains a format rule — email already had one.
        phone: undefined,
        whatsapp: undefined,
        source: 'manual',
        // `status` is not a form field. It arrives because the canonical
        // request contract carries the server's `.default('new')`, and parsing
        // MATERIALISES defaults into the body. The server applied the same
        // default before, so the created lead is identical — the value is just
        // now explicit on the wire instead of implicit.
        status: 'new',
        tags: [],
        notes: undefined,
        consentEmail: false,
        consentSms: false,
        consentVoice: false,
        // No consent box was checked, so no consent source is recorded — the
        // builder only stamps 'manual_entry' when there IS consent.
        consentSource: undefined,
      },
      { schema: leadSchema }
    );
  });

  it('surfaces a server error via toast and keeps the dialog open', async () => {
    post.mockRejectedValue(new Error('Server exploded'));
    const user = userEvent.setup();
    renderWithProviders(<CreateLeadDialog />);
    const dialog = await openDialog(user);

    await user.type(dialog.getByLabelText(/first name/i), 'Ada');
    await user.click(dialog.getByRole('button', { name: 'Create Lead' }));

    await vi.waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Server exploded')
    );
    // Dialog stayed open (onSuccess never ran to close it).
    expect(
      screen.getByRole('heading', { name: 'Create New Client' })
    ).toBeVisible();
  });

  it('disables the submit button and shows a pending label while in flight', async () => {
    let resolve!: (v: unknown) => void;
    post.mockReturnValue(
      new Promise((r) => {
        resolve = r;
      })
    );
    const user = userEvent.setup();
    renderWithProviders(<CreateLeadDialog />);
    const dialog = await openDialog(user);

    await user.type(dialog.getByLabelText(/first name/i), 'Ada');
    await user.click(dialog.getByRole('button', { name: 'Create Lead' }));

    const pending = await dialog.findByRole('button', { name: /creating/i });
    expect(pending).toBeDisabled();

    resolve({ id: 'x' });
  });
});
