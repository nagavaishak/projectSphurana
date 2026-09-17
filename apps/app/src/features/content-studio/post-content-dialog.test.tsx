import { renderWithProviders, screen, waitFor } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Scheduling from Content Studio used to submit `date`/`time` as `undefined`
 * (the form seeded neither), so the schedule branch of the schema rejected the
 * submit with "expected string, received undefined" even though the fields
 * looked populated. The dialog must seed both, and post them.
 */

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

const PAGE = {
  id: 'page-1',
  pageId: 'fb-1',
  pageName: 'Test Page',
  platform: 'facebook',
  isActive: true,
};

const h = vi.hoisted(() => {
  const captured: { url: string; body: unknown }[] = [];
  const post = vi.fn(async (url: string, body?: unknown) => {
    captured.push({ url, body });
    return { id: 'post-1' };
  });
  return { captured, post };
});

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: { post: h.post, get: vi.fn(async () => ({})) },
}));

vi.mock('@/features/integrations', () => ({
  useListMetaAdsPages: () => ({ pages: [PAGE], isLoading: false }),
}));

import { PostContentDialog } from './post-content-dialog';

const ASSET = {
  id: 'asset-1',
  name: 'Test Asset',
  blobUrl: 'https://example.com/a.jpg',
  type: 'image',
} as never;

describe('PostContentDialog — schedule mode', () => {
  beforeEach(() => {
    h.captured.length = 0;
    h.post.mockClear();
  });

  it('seeds date/time so a schedule submit posts a scheduledFor', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PostContentDialog open onOpenChange={() => {}} asset={ASSET} />
    );

    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByText(PAGE.pageName));

    await user.click(screen.getByLabelText('Schedule for Later'));

    // The seeded date must be visible, not a "Select date" placeholder.
    expect(
      screen.queryByRole('button', { name: /select date/i })
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Schedule' }));

    await waitFor(() => expect(h.post).toHaveBeenCalled());
    const body = h.captured.find((c) => c.url === 'social-posts')?.body as {
      scheduledAt?: string;
    };
    expect(body?.scheduledAt).toBeTruthy();
    expect(Number.isNaN(Date.parse(body.scheduledAt as string))).toBe(false);
  });
});
