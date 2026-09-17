import { useGetLocationSchedule } from '@/features/location-opening-hours/api/get-location-schedule/get-location-schedule.hook';
import { useGetOrgDefaults } from '@/features/org-defaults/api/get-org-defaults/get-org-defaults.hook';
import { useListLocations } from '@/features/organization-locations/api/list-locations/list-locations.hook';
import { useGetOnboardingTasks } from '@/features/organization/api/get-onboarding-tasks/get-onboarding-tasks.hook';
import { useGetOrganizationBrand } from '@/features/organization/api/get-organization-brand/get-organization-brand.hook';
import { useGetOrganizationMembers } from '@/features/organization/api/get-organization-members/get-organization-members.hook';
import { useInviteMember } from '@/features/organization/api/invite-member/invite-member.hook';
import { useListPendingInvitations } from '@/features/organization/api/list-pending-invitations/list-pending-invitations.hook';
import { useGetPractitionerForUser } from '@/features/practitioners/api/get-practitioner-for-user/get-practitioner-for-user.hook';
import { useListPractitioners } from '@/features/practitioners/api/list-practitioners/list-practitioners.hook';
/**
 * ORG-domain projection contracts (wave-2).
 *
 * Proves the org/locations/org-defaults/practitioners/opening-hours projections
 * end-to-end: a schema-validated `fixture(...)` flows through the REAL hooks —
 * each wired to `apiClient.get(path, { schema })` — into rendered output, and
 * each list/computed wrapper rejects a malformed response. Mirrors the leads
 * contract proofs.
 */
import { fireEvent, renderWithProviders, screen } from '@/test/render';
import {
  fixture,
  getOnboardingTasksResponseSchema,
  invitationResponseSchema,
  listLocationsResponseSchema,
  listOrganizationMembersResponseSchema,
  listPendingInvitationsResponseSchema,
  listPractitionersResponseSchema,
  locationScheduleResultSchema,
  orgDefaultsResponseSchema,
  organizationBrandResponseSchema,
  practitionerForUserResponseSchema,
} from '@borradh-workspace/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  aBrand,
  aLocation,
  aMember,
  aPendingInvitation,
  aPractitioner,
  aPractitionerForUser,
  aSchedule,
  anInvitation,
  onboardingTasks,
  orgDefaults,
} from './base-org';

// Mock api-client so React Query resolves our schema-validated fixtures exactly
// as production does (the hooks pass the contracts schema to apiClient.get/post).
const get = vi.fn();
const post = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

function PractitionerListHarness() {
  const { practitioners } = useListPractitioners();
  return (
    <ul>
      {practitioners.map((p) => (
        <li key={p.id}>{p.name}</li>
      ))}
    </ul>
  );
}

function LocationListHarness() {
  const { locations } = useListLocations();
  return (
    <ul>
      {locations.map((l) => (
        <li key={l.id}>{l.name}</li>
      ))}
    </ul>
  );
}

function OrgDefaultsHarness() {
  const { defaults } = useGetOrgDefaults();
  return <p>budget: {defaults?.adDailyBudgetCents ?? 'none'}</p>;
}

function ScheduleHarness() {
  const { schedule } = useGetLocationSchedule({
    locationId: 'loc_1',
    windowStart: '2024-01-01',
    windowEnd: '2024-01-07',
  });
  return <p>schedule: {schedule ? schedule.locationId : 'none'}</p>;
}

function PractitionerMeHarness() {
  const { practitioner } = useGetPractitionerForUser();
  return (
    <div>
      <p>me: {practitioner ? practitioner.name : 'none'}</p>
      <p>svc: {practitioner?.services?.[0]?.service.name ?? 'none'}</p>
    </div>
  );
}

function MembersHarness() {
  const { members } = useGetOrganizationMembers('org_1');
  return (
    <ul>
      {members.map((m) => (
        <li key={m.id}>{m.user.name}</li>
      ))}
    </ul>
  );
}

function BrandHarness() {
  const { brand } = useGetOrganizationBrand('org_1');
  return <p>brand: {brand ? brand.resolvedStyle.name : 'none'}</p>;
}

function PendingInvitesHarness() {
  const { invitations } = useListPendingInvitations();
  return (
    <ul>
      {invitations.map((i) => (
        <li key={i.id}>{i.organizationName}</li>
      ))}
    </ul>
  );
}

function OnboardingHarness() {
  const { tasks } = useGetOnboardingTasks();
  return <p>tasks: {tasks.length}</p>;
}

function InviteHarness() {
  const { execute, data } = useInviteMember('org_1');
  return (
    <div>
      <button
        type="button"
        onClick={() => execute({ email: 'grace@example.com' })}
      >
        invite
      </button>
      <p>invited: {data ? data.email : 'none'}</p>
    </div>
  );
}

describe('org domain projection contracts', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('renders practitioners from a schema-validated list response', async () => {
    const response = fixture(listPractitionersResponseSchema, {
      items: [
        aPractitioner({ id: 'p1', name: 'Ada Lovelace' }),
        aPractitioner({ id: 'p2', name: 'Grace Hopper' }),
      ],
      limit: 20,
      offset: 0,
    });
    get.mockResolvedValue(response);

    renderWithProviders(<PractitionerListHarness />);

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(await screen.findByText('Grace Hopper')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      'practitioners',
      expect.objectContaining({ schema: listPractitionersResponseSchema })
    );
  });

  it('renders locations from a schema-validated { items } wrapper', async () => {
    const response = fixture(listLocationsResponseSchema, {
      items: [aLocation({ id: 'l1', name: 'Main Clinic' })],
    });
    get.mockResolvedValue(response);

    renderWithProviders(<LocationListHarness />);

    expect(await screen.findByText('Main Clinic')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      'organization-locations',
      expect.objectContaining({ schema: listLocationsResponseSchema })
    );
  });

  it('renders resolved org defaults', async () => {
    get.mockResolvedValue(orgDefaults({ adDailyBudgetCents: 3500 }));

    renderWithProviders(<OrgDefaultsHarness />);

    expect(await screen.findByText('budget: 3500')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      'org-defaults',
      expect.objectContaining({ schema: orgDefaultsResponseSchema })
    );
  });

  it('renders a computed location schedule', async () => {
    get.mockResolvedValue(aSchedule());

    renderWithProviders(<ScheduleHarness />);

    expect(await screen.findByText('schedule: loc_1')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      expect.stringContaining('locations/loc_1/opening-hours'),
      expect.objectContaining({ schema: locationScheduleResultSchema })
    );
  });

  it('renders the current user practitioner with narrowed joins', async () => {
    get.mockResolvedValue(aPractitionerForUser({ name: 'Ada Lovelace' }));

    renderWithProviders(<PractitionerMeHarness />);

    expect(await screen.findByText('me: Ada Lovelace')).toBeTruthy();
    expect(await screen.findByText('svc: Facial')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      'practitioners/me',
      expect.objectContaining({ schema: practitionerForUserResponseSchema })
    );
  });

  it('renders user-joined members from a schema-validated array', async () => {
    get.mockResolvedValue(
      fixture(listOrganizationMembersResponseSchema, [
        aMember({ id: 'm1', user: aMember().user }),
      ])
    );

    renderWithProviders(<MembersHarness />);

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      'organizations/org_1/members',
      expect.objectContaining({ schema: listOrganizationMembersResponseSchema })
    );
  });

  it('renders the resolved brand style', async () => {
    get.mockResolvedValue(aBrand());

    renderWithProviders(<BrandHarness />);

    expect(await screen.findByText('brand: Clean & Minimal')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      'organizations/org_1/brand',
      expect.objectContaining({ schema: organizationBrandResponseSchema })
    );
  });

  it('renders pending invitations from a schema-validated array', async () => {
    get.mockResolvedValue(
      fixture(listPendingInvitationsResponseSchema, [
        aPendingInvitation({ organizationName: 'Bloom Aesthetics' }),
      ])
    );

    renderWithProviders(<PendingInvitesHarness />);

    expect(await screen.findByText('Bloom Aesthetics')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      'organizations/invitations/pending',
      expect.objectContaining({ schema: listPendingInvitationsResponseSchema })
    );
  });

  it('renders the computed onboarding checklist', async () => {
    get.mockResolvedValue(onboardingTasks());

    renderWithProviders(<OnboardingHarness />);

    expect(await screen.findByText('tasks: 2')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      'organization/onboarding-tasks',
      expect.objectContaining({ schema: getOnboardingTasksResponseSchema })
    );
  });

  it('invite-member posts with the invitation schema and returns the created invite', async () => {
    post.mockResolvedValue(anInvitation({ email: 'grace@example.com' }));

    renderWithProviders(<InviteHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'invite' }));

    expect(await screen.findByText('invited: grace@example.com')).toBeTruthy();
    expect(post).toHaveBeenCalledWith(
      'organizations/org_1/invitations',
      { email: 'grace@example.com' },
      expect.objectContaining({ schema: invitationResponseSchema })
    );
  });

  it('the members array rejects a member missing its user join', () => {
    expect(
      listOrganizationMembersResponseSchema.safeParse([
        { id: 'm1', userId: 'u1', role: 'owner', createdAt: '2024-01-01' },
      ]).success
    ).toBe(false);
  });

  it('the practitioners wrapper requires items/limit/offset', () => {
    expect(
      listPractitionersResponseSchema.safeParse({ items: [], limit: 20 })
        .success
    ).toBe(false);
  });

  it('org defaults require the overrides map', () => {
    expect(
      orgDefaultsResponseSchema.safeParse({
        organizationId: 'org_1',
        adDailyBudgetCents: 2000,
        adObjective: 'leads',
        videoOrientation: 'portrait',
        videoLengthSecs: 30,
        brandVoice: null,
        defaultServiceIdForAds: null,
        adAreaType: 'city',
        wageAutoClockIn: false,
        wageAutoClockOut: false,
        wageAutomatedBreaks: false,
        giftCardPresetAmounts: [],
        giftCardExpiry: '1y',
        // overrides missing
      }).success
    ).toBe(false);
  });
});
