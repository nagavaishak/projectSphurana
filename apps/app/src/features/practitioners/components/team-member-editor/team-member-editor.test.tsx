import { fireEvent, renderWithProviders, screen, waitFor } from '@/test/render';
import type { PractitionerWithRelations } from '@borradh-workspace/api-client/types';
import { within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The team-member editor, mounted the way the app mounts it: the shared
 * `/create/team-member` and `/edit/team-member/:id` route.
 *
 * What is asserted here is what is TEAM-MEMBER-SPECIFIC — Profile enforcing the
 * required identity fields, the permission select threading its level into the
 * composite payload, the Wages panel rendering, and edit mode pre-filling from
 * the record. The chrome, the section nav and the save bar are the shared
 * editor's and are proven once in its own harness, so the old assertions about
 * nav GROUPS and per-section COUNT BADGES are gone with the bespoke nav that
 * had them.
 *
 * The practitioner hooks and the service/location/scheduling feature hooks are
 * mocked, so we assert the exact payload the editor submits without touching
 * the network.
 */

// --- captured mutations -------------------------------------------------------
const createTeamMember = vi.fn();
const invitePractitioner = vi.fn();

vi.mock('../../api', async (importOriginal) => {
  // Keep the real payload builder so the composed create body is exercised;
  // only the mutation hooks are stubbed.
  const actual = await importOriginal<typeof import('../../api')>();
  return {
    buildCreateTeamMemberPayload: actual.buildCreateTeamMemberPayload,
    // The route resolves the record by id; create mode passes no id.
    useGetPractitioner: ({ id }: { id: string }) => ({
      practitioner: id ? existingPractitioner : null,
      isLoading: false,
      isError: false,
    }),
    useCreateTeamMember: () => ({ createTeamMember, isCreating: false }),
    useInvitePractitioner: () => ({ invitePractitioner, isInviting: false }),
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

// --- data feeding the panels --------------------------------------------------
vi.mock('@/features/organization-services', () => ({
  useListServices: () => ({
    services: [
      {
        id: 'svc_1',
        name: 'Haircut',
        categoryId: 'cat_1',
        appointmentDuration: 30,
        priceText: '€25',
      },
      {
        id: 'svc_2',
        name: 'Colour',
        categoryId: 'cat_1',
        appointmentDuration: 90,
        priceText: '€80',
      },
    ],
    isLoading: false,
    isError: false,
  }),
}));

vi.mock('@/features/service-categories', () => ({
  useListCategories: () => ({
    categories: [{ id: 'cat_1', name: 'Hair' }],
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

vi.mock('@/features/scheduling', () => ({
  WageConfigForm: () => <div>wage-config-form</div>,
  useUpdateWageConfig: () => ({ updateWageConfig: vi.fn() }),
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

/** The record edit mode resolves. Set by the edit-mode case. */
let existingPractitioner: PractitionerWithRelations | null = null;

const renderCreate = () =>
  renderWithProviders(<EntityEditorRoute mode="create" slug="team-member" />);

const renderEdit = (practitioner: PractitionerWithRelations) => {
  existingPractitioner = practitioner;
  return renderWithProviders(
    <EntityEditorRoute id={practitioner.id} mode="edit" slug="team-member" />
  );
};

/** Section nav labels render twice (desktop nav + mobile pills); either works. */
const gotoSection = (label: string) =>
  fireEvent.click(screen.getAllByRole('button', { name: label })[0]);

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

beforeEach(() => {
  createTeamMember.mockReset();
  existingPractitioner = null;
});

function fillRequiredProfile() {
  fireEvent.change(screen.getByLabelText('First name'), {
    target: { value: 'Grace' },
  });
  fireEvent.change(screen.getByLabelText('Last name'), {
    target: { value: 'Hopper' },
  });
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'grace@example.com' },
  });
}

describe('team-member editor', () => {
  it('renders every section in the nav', () => {
    renderCreate();

    const nav = within(screen.getByRole('navigation'));
    for (const item of [
      'Profile',
      'Services',
      'Locations',
      'Settings',
      'Wages and timesheets',
    ]) {
      expect(nav.getByRole('button', { name: item })).toBeInTheDocument();
    }
  });

  it('blocks submit and surfaces errors when required fields are empty', async () => {
    renderCreate();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    // The zod resolver runs async — the error text appears on the next tick.
    expect(
      await screen.findByText('First name is required')
    ).toBeInTheDocument();
    expect(screen.getByText('Last name is required')).toBeInTheDocument();
    expect(screen.getByText('Email is required')).toBeInTheDocument();
    expect(createTeamMember).not.toHaveBeenCalled();
  });

  it('renders the Wages panel', () => {
    renderCreate();

    gotoSection('Wages and timesheets');

    expect(
      screen.getByRole('heading', { name: 'Wages and timesheets' })
    ).toBeInTheDocument();
    expect(screen.getByText('Compensation')).toBeInTheDocument();
  });

  it('exposes Low/Medium/High and threads the chosen permission level into the payload', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderCreate();

    fillRequiredProfile();

    // All services are selected by default on create; deselect Colour so the
    // payload carries only the remaining association.
    gotoSection('Services');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Colour' }));

    // Set the permission level in Settings.
    gotoSection('Settings');
    await user.click(screen.getByRole('combobox'));
    expect(screen.getByRole('option', { name: 'Low' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'High' })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: 'Medium' }));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createTeamMember).toHaveBeenCalledTimes(1));
    expect(createTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({
        firstName: 'Grace',
        lastName: 'Hopper',
        email: 'grace@example.com',
        permissionLevel: 'medium',
        serviceIds: ['svc_1'],
      })
    );
  });

  /**
   * REGRESSION: the phone inputs were deleted from ProfilePanel in the
   * mobile/form-parity sweep while `phone` / `phoneCountry` / `phoneSecondary`
   * stayed in the schema and in create-team-member.payload.ts. Nothing caught
   * it: the builder still MAPS phone (its tests feed it intent directly), both
   * surfaces share this panel so payload PARITY still held, and this file's
   * other assertions use `objectContaining` on fields they name. A field the
   * payload supports must be reachable in the UI — assert the value a user
   * TYPES actually reaches the request body.
   */
  it('sends a phone number the user typed (the field must exist)', async () => {
    const user = userEvent.setup();
    renderCreate();

    fillRequiredProfile();
    await user.type(screen.getByLabelText('Country code'), '+353');
    await user.type(screen.getByLabelText('Phone'), '851234567');
    await user.type(screen.getByLabelText('Additional phone'), '019876543');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createTeamMember).toHaveBeenCalledTimes(1));
    expect(createTeamMember).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneCountry: '+353',
        phone: '851234567',
        phoneSecondary: '019876543',
      })
    );
  });

  it('pre-fills from an existing practitioner in edit mode', () => {
    const existing = {
      id: 'prac_1',
      name: 'Ada Lovelace',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      title: 'Senior Therapist',
      services: [{ serviceId: 'svc_1' }],
      locations: [{ locationId: 'loc_1' }],
    } as unknown as PractitionerWithRelations;

    renderEdit(existing);

    expect(
      (screen.getByLabelText('First name') as HTMLInputElement).value
    ).toBe('Ada');
    expect((screen.getByLabelText('Last name') as HTMLInputElement).value).toBe(
      'Lovelace'
    );
    // The page title switches to the edit affordance.
    expect(
      screen.getByRole('heading', { level: 1, name: 'Edit team member' })
    ).toBeInTheDocument();
    // The pre-selected service association is carried into the Services panel.
    gotoSection('Services');
    expect(screen.getByRole('checkbox', { name: 'Haircut' })).toHaveAttribute(
      'data-state',
      'checked'
    );
    expect(screen.getByRole('checkbox', { name: 'Colour' })).toHaveAttribute(
      'data-state',
      'unchecked'
    );
  });
});
