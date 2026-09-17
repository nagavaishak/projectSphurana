import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { UserEvent } from '@testing-library/user-event';
import { format, isSameMonth, parse } from 'date-fns';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `POST practitioners/team-member` — the composite "Add team
 * member" create.
 *
 * One editor builds this body. It used to be a bespoke full-screen surface with
 * a desktop left-nav layout and a separate mobile tab layout; it is now the
 * shared `/create/team-member` page, whose five sections are the same five
 * panels rendering off the same `teamMemberForm` declaration and handing raw
 * form values to the one `buildCreateTeamMemberPayload`.
 *
 * The harness fills every field the form DECLARES — not a hand-written list, so
 * it cannot quietly omit the field that was dropped. That matters here more than
 * anywhere: this is the form whose Phone / Country code / Additional phone
 * inputs (and its Birthday / Calendar color controls) were deleted from
 * `profile-panel.tsx` while `phone` / `phoneCountry` / `phoneSecondary` /
 * `dateOfBirth` / `color` stayed in the schema AND in
 * `create-team-member.payload.ts` — and every payload-level test stayed green,
 * because the builder still mapped them and both surfaces shared the same broken
 * panel. Property 2 (fields reachable) is what catches that.
 */

// jsdom shims for Radix Select / Popover.
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
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: (...args: unknown[]) => put(...args),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The wage panel's edit-mode form and its wage-config mutation are a separate
// operation (`PUT practitioners/:id/wage-config`); stub the module so create
// mode's own wage capture is what we exercise.
vi.mock('@/features/scheduling', () => ({
  WageConfigForm: () => <div>wage-config-form</div>,
  useUpdateWageConfig: () => ({ updateWageConfig: vi.fn() }),
}));

const uploadAsync = vi.fn();
vi.mock('@/features/upload/api/upload.hook', () => ({
  useUploadImage: () => ({ uploadAsync, isUploading: false }),
}));

// The crop dialog frames the photo with react-image-crop and exports it through
// a <canvas>: Apply only enables once the <img> has decoded and reported a
// completed crop — neither of which jsdom does, so the real dialog could never
// be applied here and the photo would look unreachable. Stub it behind the SAME
// `image-crop-apply` handle the real dialog exposes, handing the file straight
// back.
vi.mock('@/features/upload/components/image-crop-dialog', () => ({
  ImageCropDialog: ({
    file,
    onCropped,
  }: {
    file: File | null;
    onCropped: (file: File) => void;
  }) =>
    file ? (
      <button
        type="button"
        data-testid="image-crop-apply"
        onClick={() => onCropped(file)}
      >
        Apply
      </button>
    ) : null,
}));

// The shared editor is responsive in CSS rather than branched on `useIsMobile`,
// but panels below it (and the shared chrome's siblings) still read the hook.
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

// Saving navigates back to the team list; no router is stood up here.
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

import { teamMemberForm } from './components/team-member-editor/types';

const F = teamMemberForm.fields;
const sample = <K extends keyof typeof F>(key: K) =>
  (F[key] as { sample: unknown }).sample;

const SERVICES = [
  { id: 'svc_1', name: 'Haircut', categoryId: 'cat_1' },
  { id: 'svc_2', name: 'Colour', categoryId: 'cat_1' },
];
const LOCATIONS = [{ id: 'loc_1', name: 'Main Salon', isPrimary: true }];

/**
 * Open a section by its nav item.
 *
 * The label renders TWICE — the shared editor is one tree whose desktop nav and
 * mobile pills are shown by CSS, rather than two branches picked by
 * `useIsMobile`. Either button works; take the first deterministically.
 */
const gotoSection = async (user: UserEvent, label: string) => {
  await user.click(screen.getAllByRole('button', { name: label })[0]);
};

/**
 * Drive the popover DatePicker: open it, walk to the target month, click the
 * day. The day buttons are labelled with the full date ("Monday, March 2nd,
 * 2026"), so this cannot pick the wrong one.
 */
const pickDate = async (user: UserEvent, label: string, iso: string) => {
  await user.click(screen.getByLabelText(label));
  const target = parse(iso, 'yyyy-MM-dd', new Date());

  for (let i = 0; i < 400; i++) {
    const grid = await screen.findByRole('grid');
    const shown = parse(
      grid.getAttribute('aria-label') ?? '',
      'MMMM yyyy',
      new Date()
    );
    if (isSameMonth(shown, target)) break;
    await user.click(
      screen.getByRole('button', {
        name: shown < target ? /next month/i : /previous month/i,
      })
    );
  }

  await user.click(
    await screen.findByRole('button', {
      name: format(target, 'EEEE, MMMM do, yyyy'),
    })
  );
};

/** Tick a Radix checkbox to an exact state (it may already be there). */
const setChecked = async (user: UserEvent, name: string, want: boolean) => {
  const box = screen.getByRole('checkbox', { name });
  const isOn = box.getAttribute('data-state') === 'checked';
  if (isOn !== want) await user.click(box);
};

/** Pick an option out of a Radix Select located by its visible label. */
const selectOption = async (user: UserEvent, label: string, option: string) => {
  await user.click(screen.getByLabelText(label));
  await user.click(
    await screen.findByRole('option', { name: new RegExp(`^${option}$`, 'i') })
  );
};

/** The shared fills for every field whose control is bespoke. */
const fills = {
  photo: async (user: UserEvent) => {
    const input = document.querySelector(
      'input[type="file"]'
    ) as HTMLInputElement | null;
    if (!input) throw new Error('no file input behind the avatar button');
    await user.upload(
      input,
      new File(['x'], 'grace.png', { type: 'image/png' })
    );
    // Selecting a photo opens the crop dialog — apply it, otherwise nothing is
    // ever uploaded and the photo never reaches the payload.
    const apply = screen.queryByTestId('image-crop-apply');
    if (apply) await user.click(apply);
    await waitFor(() => expect(uploadAsync).toHaveBeenCalled());
  },
  color: async (user: UserEvent) => {
    await user.click(
      screen.getByRole('button', {
        name: (F.color as { sampleLabel: string }).sampleLabel,
      })
    );
  },
  employmentStartDate: (user: UserEvent) =>
    pickDate(
      user,
      F.employmentStartDate.label,
      sample('employmentStartDate') as string
    ),
  employmentEndDate: (user: UserEvent) =>
    pickDate(
      user,
      F.employmentEndDate.label,
      sample('employmentEndDate') as string
    ),
  serviceIds: async (user: UserEvent) => {
    // Create mode seeds every service; end on exactly the sample selection.
    await screen.findByRole('checkbox', { name: 'Haircut' });
    await setChecked(user, 'Haircut', true);
    await setChecked(user, 'Colour', false);
  },
  locationIds: async (user: UserEvent) => {
    await screen.findByRole('checkbox', { name: 'Main Salon' });
    await setChecked(user, 'Main Salon', true);
  },
  wage: async (user: UserEvent) => {
    await selectOption(user, 'Compensation', 'Hourly Rate');
    await user.type(screen.getByLabelText('Hourly rate'), '15.50');
    await user.click(screen.getByLabelText('Overtime'));
    await user.type(screen.getByLabelText('Regular hours'), '40');
    await selectOption(user, 'Auto clock in', 'Enabled');
    await selectOption(user, 'Auto clock out', 'Disabled');
    await selectOption(user, 'Automated breaks', 'Enabled');
    await selectOption(user, 'Location restrictions', 'Enabled');
  },
};

/** Fill every panel of the editor, in the order the user walks them. */
const driveEditor = async (ctx: {
  user: UserEvent;
  fill: (...keys: (keyof typeof F)[]) => Promise<void>;
}) => {
  await ctx.fill(
    'photo',
    'firstName',
    'lastName',
    'email',
    'phoneCountry',
    'phone',
    'phoneSecondary',
    'country',
    'dateOfBirth',
    'color',
    'jobTitle',
    'employmentStartDate',
    'employmentEndDate',
    'employmentType',
    'teamMemberRef',
    'notes'
  );

  await gotoSection(ctx.user, 'Services');
  await ctx.fill('serviceIds');

  await gotoSection(ctx.user, 'Locations');
  await ctx.fill('locationIds');

  await gotoSection(ctx.user, 'Settings');
  await ctx.fill('acceptsBookings', 'permissionLevel');

  await gotoSection(ctx.user, 'Wages and timesheets');
  await ctx.fill('wage');

  await ctx.user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(post).toHaveBeenCalled());
};

runFormContract({
  operation: 'POST practitioners',
  description: 'Create team member',
  form: teamMemberForm,
  fills,

  // ONE surface since the unified editor landed. The two here used to be the
  // bespoke editor's desktop-nav and mobile-tab layouts — separate navigation
  // code paths over one form, which is exactly the drift PROPERTY 4 exists to
  // catch. The shared editor is a single tree laid out in CSS, so there is no
  // longer a second path that could disagree.
  surfaces: [
    {
      name: 'unified entity editor (/create/team-member)',
      run: async (ctx) => {
        renderWithProviders(
          <EntityEditorRoute mode="create" slug="team-member" />
        );
        await screen.findByRole('heading', { name: 'Add team member' });
        await driveEditor(ctx);
      },
    },
  ],

  reset: () => {
    uploadAsync.mockReset();
    uploadAsync.mockResolvedValue({ url: sample('photo') });
    post.mockReset();
    post.mockResolvedValue({ id: 'prac_new' });
    put.mockReset();
    put.mockResolvedValue({ id: 'prac_new' });
    get.mockReset();
    get.mockImplementation((path: string) => {
      if (path.startsWith('organization-services')) {
        return Promise.resolve({ items: SERVICES, total: SERVICES.length });
      }
      if (path.startsWith('service-categories')) {
        return Promise.resolve([{ id: 'cat_1', name: 'Hair' }]);
      }
      if (path.startsWith('organization-locations')) {
        return Promise.resolve({ items: LOCATIONS });
      }
      return Promise.resolve({ items: [] });
    });
  },

  readBody: () => {
    const call = post.mock.calls.find(
      (c) => c[0] === 'practitioners/team-member'
    );
    if (!call)
      throw new Error('no POST practitioners/team-member call captured');
    return call[1] as Record<string, unknown>;
  },

  // Derived from the field samples, plus the one genuinely different shape the
  // builder computes: the wage panel's strings become a cents/number wageConfig.
  expectedBody: () =>
    expectedFromFields(teamMemberForm.fields, {
      wageConfig: {
        compensationType: 'hourly',
        hourlyRateCents: 1550,
        overtimeEnabled: true,
        regularWorkHours: 40,
        regularWorkHoursPer: 'week',
        overtimeType: 'multiplier',
        overtimeMultiplier: 1.5,
        overtimeHourlyRateCents: null,
        autoClockIn: 'enabled',
        autoClockOut: 'disabled',
        automatedBreaks: 'enabled',
        locationRestriction: 'enabled',
      },
    }),
});
