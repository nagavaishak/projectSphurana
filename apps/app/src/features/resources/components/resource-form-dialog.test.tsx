import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ResourceFormDialog.
 *
 * The assertion that matters most is the availability mapping: `workingHours:
 * null` means ALWAYS AVAILABLE, so the switch being ON must send `null` and
 * NOT an all-days-filled object. Sending an object would pin the room to this
 * form's defaults and make it unbookable outside them.
 */
const get = vi.fn();
const post = vi.fn();
const put = vi.fn();

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    delete: () => Promise.resolve(),
  },
  isApiClientError: () => false,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ResourceFormDialog } from './resource-form-dialog';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as never;
if (!Element.prototype.scrollIntoView)
  Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.hasPointerCapture)
  Element.prototype.hasPointerCapture = () => false;

const categories = [
  {
    id: 'cat_rooms',
    organizationId: 'org_1',
    name: 'Rooms',
    kind: 'room' as const,
    description: null,
    sortOrder: 0,
    isActive: true,
    resourceCount: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
  },
];

const renderDialog = (props: Record<string, unknown> = {}) =>
  renderWithProviders(
    <ResourceFormDialog
      open
      onOpenChange={() => {}}
      // biome-ignore lint/suspicious/noExplicitAny: fixture rows are partial by design
      categories={categories as any}
      {...props}
    />
  );

/**
 * Capacity, specs and per-room hours now live behind "More options" — they
 * apply to a minority of rooms and giving them equal billing with Name turned
 * the dialog into a field dump. Tests that exercise them must open the section
 * first, exactly as a user would.
 */
async function openMoreOptions(user: ReturnType<typeof userEvent.setup>) {
  const trigger = screen.queryByRole('button', { name: /more options/i });
  if (trigger) await user.click(trigger);
}

describe('ResourceFormDialog', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    post.mockResolvedValue({});
    put.mockResolvedValue({});
    get.mockImplementation(() => Promise.resolve({ items: [] }));
  });

  it('sends workingHours: null when "Always available" is left ON', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Room 2');
    await openMoreOptions(user);
    expect(screen.getByLabelText('Always available')).toBeChecked();

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      'resources',
      expect.objectContaining({
        name: 'Room 2',
        categoryId: 'cat_rooms',
        capacity: 1,
        // ⚠️ null, NOT a filled week.
        workingHours: null,
      })
    );
  });

  it('reveals the weekly editor and sends the day map when "Always available" is turned OFF', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Rented room');
    expect(screen.queryByLabelText('Monday')).not.toBeInTheDocument();

    await openMoreOptions(user);
    await user.click(screen.getByLabelText('Always available'));

    const monday = await screen.findByLabelText('Monday');
    await user.click(monday);
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      'resources',
      expect.objectContaining({
        workingHours: { 1: { from: 540, to: 1020 } },
      })
    );
  });

  it('refuses to submit an always-available-off resource with no days', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Never bookable');
    await openMoreOptions(user);
    await user.click(screen.getByLabelText('Always available'));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(await screen.findByText(/can never be booked/i)).toBeVisible();
    expect(post).not.toHaveBeenCalled();
  });

  it('steps capacity and sends it', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Nail bar');
    await openMoreOptions(user);
    await user.click(screen.getByRole('button', { name: 'Increase capacity' }));
    await user.click(screen.getByRole('button', { name: 'Increase capacity' }));
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      'resources',
      expect.objectContaining({ capacity: 3 })
    );
  });

  it('collects specs as a key/value record and drops blank rows', async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.type(screen.getByLabelText('Name'), 'Room 2');
    await openMoreOptions(user);
    await user.click(screen.getByRole('button', { name: 'Add spec' }));
    await user.type(screen.getByLabelText('Spec 1 name'), 'Size');
    await user.type(screen.getByLabelText('Spec 1 value'), '3.5 x 4m');
    await user.click(screen.getByRole('button', { name: 'Add spec' }));

    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      'resources',
      expect.objectContaining({ specs: { Size: '3.5 x 4m' } })
    );
  });

  it('auto-assigns an unused colour so a new room is never colourless', async () => {
    const user = userEvent.setup();
    // 'blue' is already spoken for in this category.
    renderDialog({ takenColors: ['blue'] });

    await user.type(screen.getByLabelText('Name'), 'Room 3');
    await user.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const body = post.mock.calls[0][1] as { color: string | null };
    // Colour is the rooms calendar's whole visual signal — shipping it unset
    // means the feature arrives in its "off" state and nobody goes back to
    // fill it in. And it must not collide with the colour already in use.
    expect(body.color).toBeTruthy();
    expect(body.color).not.toBe('blue');
  });

  it('hides the location field for a single-location clinic', async () => {
    get.mockImplementation(() =>
      Promise.resolve({ items: [{ id: 'loc_1', name: 'Dublin' }] })
    );
    renderDialog();

    expect(await screen.findByLabelText('Name')).toBeVisible();
    expect(screen.queryByLabelText('Location')).not.toBeInTheDocument();
  });

  it('shows the location field once the org has more than one location', async () => {
    get.mockImplementation(() =>
      Promise.resolve({
        items: [
          { id: 'loc_1', name: 'Dublin' },
          { id: 'loc_2', name: 'Cork' },
        ],
      })
    );
    renderDialog();

    expect(await screen.findByLabelText('Location')).toBeVisible();
  });
});
