import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT /users/:id` — update user profile.
 *
 * Two surfaces edit the profile: the `settings/index` route's profile card and
 * the user-settings dialog's profile tab. Both build their form from the one
 * {@link updateUserForm} declaration and hand the intent to the one
 * `buildUpdateUserPayload`, which emits only the keys the surface set.
 *
 * `name` is the only editable field. Each surface also renders a DISABLED email
 * input — deliberately not a form field (see `update-user.form`), never
 * submitted, so the harness has nothing to fill there.
 */

const put = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    put: (...args: unknown[]) => put(...args),
    get: (...args: unknown[]) => get(...args),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The PostHog provider reaches the app router, which imports the generated route
// tree — which imports this route back. Stub the analytics surface to keep the
// module graph acyclic under vitest.
vi.mock('@/components/providers', () => ({ trackEvent: vi.fn() }));
vi.mock('@/components/posthog-provider', () => ({
  resetUser: vi.fn(),
  identifyUser: vi.fn(),
  trackEvent: vi.fn(),
}));

// The settings route's delete-account card navigates on success.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

import ProfileTab from '@/components/app/user-settings/tabs/profile';
import { updateUserForm } from '@/features/user/api/update-user';
import { Route as SettingsRoute } from '@/routes/_authed/dashboard/settings/index';

const USER_ID = 'user-1';

const USER = {
  id: USER_ID,
  name: 'Fox Mulder',
  email: 'fox@x-files.gov',
  emailVerified: true,
  image: null,
  organizationId: 'org-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SettingsPage = SettingsRoute.options
  .component as unknown as React.ComponentType;

/** Both surfaces render the one shared field, so one walk fits both. */
const fillAndSubmit = async (ctx: {
  fillRest: () => Promise<void>;
  user: import('@testing-library/user-event').UserEvent;
}) => {
  // Each surface loads the user and resets the form on arrival — wait for that
  // before typing, or the reset overwrites what we filled. Re-query on every
  // poll: the settings route swaps its cards for skeletons while the user query
  // is in flight, so the first-rendered input is a detached node.
  await waitFor(() =>
    expect(screen.getByLabelText(/^\s*Name\s*$/i)).toHaveValue(USER.name)
  );

  await ctx.fillRest();
  await ctx.user.click(screen.getByRole('button', { name: /save changes/i }));
  await waitFor(() => expect(put).toHaveBeenCalled());
};

runFormContract({
  operation: 'PUT users/:id',
  description: 'Update user profile',
  form: updateUserForm,

  surfaces: [
    {
      name: 'settings/index route',
      run: async (ctx) => {
        renderWithProviders(<SettingsPage />);
        await fillAndSubmit(ctx);
      },
    },
    {
      name: 'user-settings profile tab',
      run: async (ctx) => {
        renderWithProviders(<ProfileTab />);
        await fillAndSubmit(ctx);
      },
    },
  ],

  reset: () => {
    put.mockReset();
    put.mockResolvedValue(USER);
    get.mockReset();
    // Both surfaces read the signed-in user: the route via `useGetUser`, the tab
    // via `useSession`.
    get.mockImplementation((path: string) =>
      Promise.resolve(
        path === 'auth/session'
          ? { user: USER, session: { id: 'sess-1' } }
          : USER
      )
    );
  },

  readBody: () => {
    const call = put.mock.calls.find((c) => c[0] === `users/${USER_ID}`);
    if (!call) throw new Error(`no PUT users/${USER_ID} call captured`);
    return call[1] as Record<string, unknown>;
  },

  // Straight from the field samples — the builder emits exactly the keys the
  // surface set, and `name` is the only one either surface sets.
  expectedBody: () => expectedFromFields(updateUserForm.fields),
});
