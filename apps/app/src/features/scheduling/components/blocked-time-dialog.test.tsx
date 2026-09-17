import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Component tests for the block-off-time FORM (Fresha "Add blocked time"),
 * ported from the calendar E2E's block-off dialog case. The E2E only proves the
 * dialog opens; here we own the FORM behaviour: required-field validation, the
 * exact create payload sent through the mocked apiClient, edit-mode prefill +
 * update payload, server-error surfacing, and the in-flight pending state.
 *
 * We mock `@borradh-workspace/api-client` so the REAL mutation hooks
 * (useCreateBlockedTime/useUpdateBlockedTime) run — including their sonner
 * toasts — exactly as in production, and route GETs to seed the type/
 * practitioner pickers. The dialog's own defaults make date + start/end times
 * valid out of the box, so the only required field a user must supply is Title.
 */

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
    delete: vi.fn(),
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}));

import { BlockedTimeDialog } from './blocked-time-dialog';

// apiClient.get is URL-routed: the type picker and practitioner multi-select
// each fire one GET. Default to empty collections; individual tests override.
function routeGet(url: string) {
  if (typeof url === 'string' && url.startsWith('blocked-time-types')) {
    return Promise.resolve([]);
  }
  if (typeof url === 'string' && url.startsWith('practitioners')) {
    return Promise.resolve({ items: [], total: 0 });
  }
  return Promise.resolve({ items: [], total: 0 });
}

describe('BlockedTimeDialog (form)', () => {
  beforeEach(() => {
    get.mockImplementation((url: string) => routeGet(url));
    post.mockResolvedValue({ id: 'bt-1' });
    put.mockResolvedValue({ id: 'bt-1' });
  });

  it('renders the create heading and its fields with labels', async () => {
    renderWithProviders(<BlockedTimeDialog open onOpenChange={() => {}} />);

    expect(
      await screen.findByRole('heading', { name: /add blocked time/i })
    ).toBeVisible();
    expect(screen.getByLabelText('Title')).toBeVisible();
    expect(screen.getByLabelText('Date')).toBeVisible();
    expect(screen.getByText('Start time')).toBeVisible();
    expect(screen.getByText('End time')).toBeVisible();
    expect(screen.getByText('Team members')).toBeVisible();
  });

  it('blocks submit and shows an inline error when Title is empty', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<BlockedTimeDialog open onOpenChange={onOpenChange} />);

    await screen.findByRole('heading', { name: /add blocked time/i });
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(await screen.findByText('Title is required')).toBeVisible();
    // The mutation must NOT fire on an invalid form, and the dialog stays open.
    expect(post).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('sends the exact create payload for a valid submit and closes on success', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<BlockedTimeDialog open onOpenChange={onOpenChange} />);

    await screen.findByRole('heading', { name: /add blocked time/i });
    await user.type(screen.getByLabelText('Title'), 'Lunch break');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));

    const [url, payload] = post.mock.calls[0];
    expect(url).toBe('blocked-time');
    expect(payload).toMatchObject({
      blockedTimeTypeId: null, // custom type => no preset
      title: 'Lunch break',
      description: null,
      allDay: false,
      rrule: null, // "Doesn't repeat" default
      recurrenceEndDate: null,
      practitionerIds: [], // empty = whole team
    });
    expect(payload.startDate).toBeInstanceOf(Date);
    expect(payload.endDate).toBeInstanceOf(Date);
    // Default end time is start + 60m, so end must be after start.
    expect(payload.endDate.getTime()).toBeGreaterThan(
      payload.startDate.getTime()
    );

    // onSuccess (mocked resolve) closes the dialog + toasts success.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalled();
  });

  it('surfaces a server error via toast and keeps the dialog open', async () => {
    post.mockRejectedValueOnce(new Error('Server exploded'));
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<BlockedTimeDialog open onOpenChange={onOpenChange} />);

    await screen.findByRole('heading', { name: /add blocked time/i });
    await user.type(screen.getByLabelText('Title'), 'Lunch break');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith('Server exploded')
    );
    // Never closed on failure.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('prefills fields in edit mode and sends an update payload', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <BlockedTimeDialog
        open
        onOpenChange={onOpenChange}
        editing={{
          id: 'bt-existing',
          rrule: null,
          recurrenceEndDate: null,
          blockedTimeTypeId: null,
          title: 'Team meeting',
          description: 'weekly sync',
          startDate: '2026-03-02T09:00:00.000Z',
          endDate: '2026-03-02T10:00:00.000Z',
          practitionerIds: [],
          paid: false,
        }}
      />
    );

    // Edit heading + prefilled title.
    expect(
      await screen.findByRole('heading', { name: /edit blocked time/i })
    ).toBeVisible();
    const title = screen.getByLabelText('Title') as HTMLInputElement;
    expect(title.value).toBe('Team meeting');

    // Change the title and save → PUT with the updated value.
    await user.clear(title);
    await user.type(title, 'Team standup');
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(put).toHaveBeenCalledTimes(1));
    const [url, payload] = put.mock.calls[0];
    // Non-recurring edit → scope=all appended by the update hook.
    expect(url).toMatch(/^blocked-time\/bt-existing(\?scope=all)?$/);
    expect(payload).toMatchObject({ title: 'Team standup' });
    expect(post).not.toHaveBeenCalled();
  });
});
