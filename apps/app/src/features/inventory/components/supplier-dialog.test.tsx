import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { Supplier } from '@borradh-workspace/api-client/types';
import { fixture, supplierSchema } from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors the E2E catalog/suppliers.spec.ts create → edit → delete flow.
const post = vi.fn();
const put = vi.fn();
const get = vi.fn();
const del = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: (...a: unknown[]) => del(...a),
  },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { toast } from 'sonner';
import { SupplierDialog } from './supplier-dialog';

const existingSupplier: Supplier = fixture(supplierSchema, {
  id: 's1',
  organizationId: 'org_1',
  name: 'Salon Supplies Co.',
  description: 'Wholesale salon consumables',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
});

describe('SupplierDialog', () => {
  beforeEach(() => {
    post.mockResolvedValue({ id: 'new-supplier' });
    put.mockResolvedValue({ id: 's1' });
    get.mockResolvedValue([]);
  });

  it('renders the name + description fields (create mode)', () => {
    renderWithProviders(<SupplierDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Add supplier' })).toBeVisible();
    expect(screen.getByLabelText('Name')).toBeVisible();
    expect(screen.getByLabelText('Description')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Create supplier' })
    ).toBeVisible();
  });

  it('blocks submit and surfaces an error when the name is blank', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SupplierDialog open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText('Name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create supplier' }));

    expect(toast.error).toHaveBeenCalledWith('Name is required');
    expect(post).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('creates a supplier with the exact payload and closes on success', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SupplierDialog open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText('Name'), 'Salon Supplies Co.');
    await user.type(
      screen.getByLabelText('Description'),
      'Wholesale salon consumables'
    );
    await user.click(screen.getByRole('button', { name: 'Create supplier' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('suppliers', {
      name: 'Salon Supplies Co.',
      description: 'Wholesale salon consumables',
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('hydrates + renames in edit mode', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <SupplierDialog
        open
        onOpenChange={() => {}}
        supplier={existingSupplier}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Edit supplier' })
    ).toBeVisible();
    const name = await screen.findByDisplayValue('Salon Supplies Co.');
    await user.clear(name);
    await user.type(name, 'Renamed Co.');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('suppliers/s1', {
      name: 'Renamed Co.',
      description: 'Wholesale salon consumables',
    });
  });

  it('keeps the dialog open and toasts when the server rejects', async () => {
    post.mockRejectedValueOnce(new Error('boom'));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<SupplierDialog open onOpenChange={onOpenChange} />);

    await user.type(screen.getByLabelText('Name'), 'Salon Supplies Co.');
    await user.click(screen.getByRole('button', { name: 'Create supplier' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('boom'));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('disables the submit button while the create is in flight', async () => {
    let resolvePost: (v: unknown) => void = () => {};
    post.mockImplementationOnce(
      () =>
        new Promise((res) => {
          resolvePost = res;
        })
    );
    const user = userEvent.setup();
    renderWithProviders(<SupplierDialog open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText('Name'), 'Salon Supplies Co.');
    const submit = screen.getByRole('button', { name: 'Create supplier' });
    await user.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    resolvePost({ id: 'new-supplier' });
  });
});
