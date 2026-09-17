import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { ProductCategory } from '@borradh-workspace/api-client/types';
import { fixture, productCategorySchema } from '@borradh-workspace/contracts';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mirrors the E2E catalog/categories.spec.ts create → edit flow. Product
// categories carry a name only (no description).
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
import { ProductCategoryDialog } from './product-category-dialog';

const existingCategory: ProductCategory = fixture(productCategorySchema, {
  id: 'c1',
  organizationId: 'org_1',
  name: 'Shampoo',
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
});

describe('ProductCategoryDialog', () => {
  beforeEach(() => {
    post.mockResolvedValue({ id: 'new-cat' });
    put.mockResolvedValue({ id: 'c1' });
    get.mockResolvedValue([]);
  });

  it('renders the name field (create mode)', () => {
    renderWithProviders(<ProductCategoryDialog open onOpenChange={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Add category' })).toBeVisible();
    expect(screen.getByLabelText('Name')).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Create category' })
    ).toBeVisible();
  });

  it('blocks submit and surfaces an error when the name is blank', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ProductCategoryDialog open onOpenChange={onOpenChange} />
    );

    await user.type(screen.getByLabelText('Name'), '   ');
    await user.click(screen.getByRole('button', { name: 'Create category' }));

    expect(toast.error).toHaveBeenCalledWith('Name is required');
    expect(post).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('creates a category with the exact payload and closes on success', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ProductCategoryDialog open onOpenChange={onOpenChange} />
    );

    await user.type(screen.getByLabelText('Name'), 'Shampoo');
    await user.click(screen.getByRole('button', { name: 'Create category' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('product-categories', {
      name: 'Shampoo',
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('hydrates + renames in edit mode', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <ProductCategoryDialog
        open
        onOpenChange={() => {}}
        category={existingCategory}
      />
    );

    expect(
      screen.getByRole('heading', { name: 'Edit category' })
    ).toBeVisible();
    const name = await screen.findByDisplayValue('Shampoo');
    await user.clear(name);
    await user.type(name, 'Conditioner');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    expect(put).toHaveBeenCalledWith('product-categories/c1', {
      name: 'Conditioner',
    });
  });

  it('keeps the dialog open and toasts when the server rejects', async () => {
    post.mockRejectedValueOnce(new Error('nope'));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <ProductCategoryDialog open onOpenChange={onOpenChange} />
    );

    await user.type(screen.getByLabelText('Name'), 'Shampoo');
    await user.click(screen.getByRole('button', { name: 'Create category' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('nope'));
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
    renderWithProviders(<ProductCategoryDialog open onOpenChange={() => {}} />);

    await user.type(screen.getByLabelText('Name'), 'Shampoo');
    const submit = screen.getByRole('button', { name: 'Create category' });
    await user.click(submit);

    await waitFor(() => expect(submit).toBeDisabled());
    resolvePost({ id: 'new-cat' });
  });
});
