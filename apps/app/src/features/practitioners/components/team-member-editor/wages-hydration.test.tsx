import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { PractitionerWithRelations } from '@borradh-workspace/api-client/types';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The Wages panel must show a team member's SAVED wage config.
 *
 * THE BUG: opening Wages for a practitioner who had an hourly rate showed an
 * EMPTY compensation select and no rate field. The saved rate was invisible, and
 * a Save from that state would write "No Compensation" over a real wage.
 *
 * Cause: Radix Select renders a hidden native <select> for form participation —
 * but ONLY inside a `<form>`, and the editor renders its panels in one. That
 * bubble input's <option>s come from the SelectItems, which mount only while the
 * dropdown is OPEN. So hydrating the value programmatically on a CLOSED select
 * left it with no matching option, it settled on "", and echoed that back
 * through onValueChange('') — wiping the value that had just loaded. Fixed in
 * `components/ui/select.tsx` by dropping the empty emission (Radix rejects
 * `<SelectItem value="">`, so "" can never be a real selection).
 *
 * Why nothing caught it: team-member-editor.test.tsx mocks `@/features/scheduling`
 * and swaps WageConfigForm for a `<div>`, so the real form never rendered inside
 * the real editor. Here only the TRANSPORT is stubbed — the editor, WagesPanel,
 * WageConfigForm, the real `useGetWageConfig` and the real contract all run, and
 * crucially the form sits inside the editor's <form>, which is what made it fail.
 */

const WAGE_CONFIG = {
  practitionerId: 'prac_1',
  organizationId: 'org_1',
  compensationType: 'hourly',
  hourlyRateCents: 1850,
  overtimeEnabled: false,
  regularWorkHours: null,
  regularWorkHoursPer: 'week',
  overtimeType: null,
  overtimeMultiplier: null,
  overtimeHourlyRateCents: null,
  autoClockIn: 'workspace_default',
  autoClockOut: 'workspace_default',
  automatedBreaks: 'workspace_default',
  locationRestriction: 'workspace_default',
  createdAt: '2026-07-13T17:46:35.762Z',
  updatedAt: '2026-07-13T17:46:36.322Z',
};

vi.mock('@borradh-workspace/api-client', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@borradh-workspace/api-client')>();
  return {
    ...actual,
    apiClient: {
      get: vi.fn(async (path: string, opts?: { schema?: unknown }) =>
        actual.parseResponse(path, WAGE_CONFIG, opts?.schema as never)
      ),
      put: vi.fn(async () => WAGE_CONFIG),
      post: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>();
  return {
    buildCreateTeamMemberPayload: actual.buildCreateTeamMemberPayload,
    // The route resolves the record by id.
    useGetPractitioner: () => ({
      practitioner,
      isLoading: false,
      isError: false,
    }),
    useCreateTeamMember: () => ({
      createTeamMember: vi.fn(),
      isCreating: false,
    }),
    useInvitePractitioner: () => ({
      invitePractitioner: vi.fn(),
      isInviting: false,
    }),
    useUpdatePractitioner: () => ({
      updatePractitionerAsync: vi.fn().mockResolvedValue({}),
      isUpdating: false,
    }),
    useAssignPractitionerServices: () => ({
      assignServicesAsync: vi.fn().mockResolvedValue({}),
    }),
    useAssignPractitionerLocations: () => ({
      assignLocationsAsync: vi.fn().mockResolvedValue({}),
    }),
  };
});

vi.mock('@/features/organization-services', () => ({
  useListServices: () => ({ services: [], isLoading: false, isError: false }),
}));
vi.mock('@/features/service-categories', () => ({
  useListCategories: () => ({
    categories: [],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/features/organization-locations', () => ({
  useListLocations: () => ({
    locations: [{ id: 'loc_1', name: 'Main Salon', isPrimary: true }],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Navigate: () => null,
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

import { EntityEditorRoute } from '@/features/entity-editors/entity-editor-route';

const practitioner = {
  id: 'prac_1',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  services: [],
  locations: [],
} as unknown as PractitionerWithRelations;

beforeAll(() => {
  // Radix Select + useIsMobile rely on browser APIs jsdom omits.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('team-member editor — Wages panel hydration', () => {
  it('shows the SAVED hourly rate when opening Wages for an existing member', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <EntityEditorRoute id={practitioner.id} mode="edit" slug="team-member" />
    );

    // The section label renders twice (desktop nav + mobile pills).
    await user.click(
      screen.getAllByRole('button', { name: 'Wages and timesheets' })[0]
    );

    // The rate field only renders once compensationType hydrates to `hourly`,
    // so its presence IS the assertion that the saved config survived.
    await waitFor(
      () => {
        expect(screen.getByLabelText('Hourly rate')).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
    expect(screen.getByLabelText('Hourly rate')).toHaveValue(18.5);
  });
});
