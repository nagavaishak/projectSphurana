import { renderWithProviders, screen } from '@/test/render';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The home overview aggregates several read hooks (session, appointments,
// conversations, Claire recommendations, pending invitations) — all through
// apiClient.get. Route by URL so each resolves an empty/fresh-org shape.
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The Claire launcher (HomePrompt) imports ASSISTANT_UPLOAD_MIME_TYPES from the
// assistant barrel, which eagerly evaluates the full chat composer (and crashes
// on a circular-init `.join`). Stub the one constant it actually needs.
vi.mock('@/features/assistant', () => ({
  ASSISTANT_UPLOAD_MIME_TYPES: ['image/png', 'image/jpeg'],
}));

// HomePrompt (the Claire launcher) calls useNavigate; keep the rest of the
// router real for the import graph.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import { HomeNew } from '@/routes/_authed/dashboard/-components/home-new';

function defaultGet(url: string) {
  if (url.startsWith('auth/session')) {
    return Promise.resolve({
      user: { id: 'u1', email: 'ada@x.io', name: 'Ada Lovelace' },
      session: {},
    });
  }
  if (url.startsWith('claire/recommendations')) return Promise.resolve([]);
  if (url.includes('invitations/pending')) return Promise.resolve([]);
  // appointments / conversations lists.
  return Promise.resolve({ items: [], total: 0 });
}

describe('HomeNew (home dashboard)', () => {
  beforeEach(() => {
    get.mockImplementation((url: string) => defaultGet(url));
  });

  it('greets the signed-in user and renders the update card', async () => {
    renderWithProviders(<HomeNew />);

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: /welcome back, ada/i,
      })
    ).toBeVisible();
    expect(screen.getByText("Here's your update for today")).toBeVisible();
    expect(screen.getByText("Today's Update")).toBeVisible();
  });

  it('renders the Claire prompt launcher', async () => {
    renderWithProviders(<HomeNew />);

    expect(
      await screen.findByPlaceholderText('Ask me what you want to do...')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Recents' })).toBeVisible();
  });
});
