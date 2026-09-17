import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { ProductBrand } from '@borradh-workspace/api-client/types';
import { fixture, productBrandSchema } from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors the E2E catalog/brands.spec.ts create → edit → delete flow at the
// component level. The dialog writes through useCreateProductBrand /
// useUpdateProductBrand → apiClient.post/put, so we mock the api-client and
// sonner toast and drive the form with user-event.
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
import { ProductBrandDialog } from './product-brand-dialog';

const existingBrand: ProductBrand = fixture(productBrandSchema, {
  id: 'b1',
  organizationId: 'org_1',
  name: 'Kerastase',
  description: 'Premium hair care',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
});

describe('ProductBrandDialog', () => {
  beforeEach(() => {
    post.mockResolvedValue({ id: 'new-brand' });
    put.mockResolvedValue({ id: 'b1' });
    get.mockResolvedValue([]);
  });

  it('renders the name + description fields with their labels (create mode)', () => {
    renderWithProviders(<ProductBrandDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Add brand' })).toBeVisible();
    expect(screen.getByLabelText('Name')).toBeVisible();
    expect(screen.getByLabelText('Description')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Create brand' })).toBeVisible();
  });

  it('blocks submit and surfaces an error when the name is blank', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ProductBrandDialog open onOpenChange={onOpenChange} />
    );

    // Whitespace satisfies the `required` attr but fails the trim() guard.
    await user.type(screen.getByLabelText('Name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create brand' }));

    expect(toast.error).toHaveBeenCalledWith('Name is required');
    expect(post).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('creates a brand with the exact payload and closes on success', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ProductBrandDialog open onOpenChange={onOpenChange} />
    );

    await user.type(screen.getByLabelText('Name'), 'Kerastase');
    await user.type(screen.getByLabelText('Description'), 'Premium hair care');
    await user.click(screen.getByRole('button', { name: 'Create brand' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('product-brands', {
      name: 'Kerastase',
      description: 'Premium hair care',
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('hydrates the saved values in edit mode and sends the renamed payload', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProductBrandDialog open onOpenChange={() => {}} brand={existingBrand} />
    );

    expect(screen.getByRole('heading', { name: 'Edit brand' })).toBeVisible();
    const name = await screen.findByDisplayValue('Kerastase');
    await user.clear(name);
    await user.type(name, 'Kerastase RENAMED');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('product-brands/b1', {
      name: 'Kerastase RENAMED',
      description: 'Premium hair care',
    });
  });

  it('keeps the dialog open and toasts when the server rejects', async () => {
    post.mockRejectedValueOnce(new Error('Server exploded'));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ProductBrandDialog open onOpenChange={onOpenChange} />
    );

    await user.type(screen.getByLabelText('Name'), 'Kerastase');
    await user.click(screen.getByRole('button', { name: 'Create brand' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('Server exploded')
    );
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
    renderWithProviders(<ProductBrandDialog open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText('Name'), 'Kerastase');
    const submit = screen.getByRole('button', { name: 'Create brand' });
    await user.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    resolvePost({ id: 'new-brand' });
  });
});
