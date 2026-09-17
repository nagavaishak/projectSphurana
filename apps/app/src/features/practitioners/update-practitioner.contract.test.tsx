import { expectedFromFields } from '@/lib/form-contract/fields';
import type { Surface } from '@/test/form-contract/contract';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { PractitionerWithRelations } from '@borradh-workspace/api-client/types';
import type { UserEvent } from '@testing-library/user-event';
import { format, isSameMonth, parse } from 'date-fns';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT practitioners/:id` — update team member.
 *
 * FOUR surfaces write this endpoint, and each owns a DIFFERENT SLICE of the
 * practitioner (PATCH: `buildUpdatePractitionerPayload` emits only the keys the
 * surface hands it):
 *
 *   - the profile dialog        → name / email / phone / title / bio
 *   - the team-member editor    → the whole employment record
 *   - onboarding setup-profile  → the photo + title, then the working hours
 *   - the invited-member wizard → the public profile, one step at a time
 *
 * A STEP IS A SURFACE. setup-profile and the wizard each PUT once per step, with
 * a different slice each time, so they are registered per step — otherwise the
 * body a "surface" produced would depend on where you happened to stop it.
 *
 * `owns` is what makes that expressible, and the harness still holds the two
 * lines that matter: every field must be owned by AT LEAST ONE surface (nothing
 * may fall off the app entirely — that is the dropped-field bug), and where two
 * surfaces own the SAME field they must send it identically. That last one is the
 * historical drift this replaces: the dialog once omitted an emptied optional
 * while the editor and the wizard nulled it, so clearing a bio behaved
 * differently depending on where you did it.
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
globalThis.URL.createObjectURL ??= (() => 'blob:preview') as never;

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

vi.mock('@/features/scheduling', () => ({
  WageConfigForm: () => <div>wage-config-form</div>,
  useUpdateWageConfig: () => ({ updateWageConfig: vi.fn() }),
}));

const uploadAsync = vi.fn();
vi.mock('@/features/upload/api/upload.hook', () => ({
  useUploadImage: () => ({ uploadAsync, isUploading: false }),
}));

// The wizard crops the chosen photo on a <canvas>, which jsdom has not got.
vi.mock('@/features/onboarding/team-member-wizard/crop-to-square', () => ({
  cropToSquare: async (file: File) => file,
}));

// The crop dialog frames the photo with react-image-crop and exports it through
// a <canvas>: Apply only enables once the <img> has decoded and reported a
// completed crop — neither of which jsdom does, so the real dialog could never
// be applied here and the photo would look unreachable. Stub it behind the SAME
// `image-crop-apply` handle the real dialog exposes, handing the file straight
// back (the identity-crop shortcut `cropToSquare` above already uses).
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

// Onboarding's Google-Calendar step owns no field of this operation and reaches
// for the runtime API config; stub the step, keep the wizard around it real.
vi.mock(
  '@/features/onboarding/setup-profile/tabs/step-calendar-connect',
  () => ({
    StepCalendarConnect: () => <div>calendar-connect</div>,
  })
);

vi.mock('@/features/auth/api/get-session', () => ({
  useGetSession: () => ({
    user: { id: 'user_1', email: 'ada@example.com' },
    session: {},
    isLoading: false,
    isAuthenticated: true,
  }),
}));

vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/customers' } }),
}));

import { EntityEditorRoute } from '@/features/entity-editors/entity-editor-route';
import { SetupProfileForm } from '@/features/onboarding/setup-profile/setup-profile-form';
import { TeamMemberWizard } from '@/features/onboarding/team-member-wizard';

import { updatePractitionerForm } from './api/update-practitioner';
import { PractitionerDialog } from './components/practitioner-dialog';

type Fields = typeof updatePractitionerForm.specs;
const F = updatePractitionerForm.fields;
const sample = <K extends keyof typeof F>(key: K) =>
  (F[key] as { sample: unknown }).sample;

const PRACTITIONER_ID = 'prac_1';

const EXISTING = {
  id: PRACTITIONER_ID,
  name: 'Ada Lovelace',
  firstName: 'Ada',
  lastName: 'Lovelace',
  email: 'ada@example.com',
  phone: null,
  title: 'Senior Therapist',
  bio: null,
  photo: null,
  profileSetupCompleted: false,
  services: [{ serviceId: 'svc_1', service: { id: 'svc_1' } }],
  locations: [{ locationId: 'loc_1' }],
} as unknown as PractitionerWithRelations;

const SERVICES = [
  { id: 'svc_1', name: 'Haircut', categoryId: 'cat_1' },
  { id: 'svc_2', name: 'Colour', categoryId: 'cat_1' },
];
const LOCATIONS = [{ id: 'loc_1', name: 'Main Salon', isPrimary: true }];

const routeGet = (path: string) => {
  if (path.startsWith('practitioners/me')) return Promise.resolve(EXISTING);
  if (path.startsWith('organization-services')) {
    return Promise.resolve({ items: SERVICES, total: SERVICES.length });
  }
  if (path.startsWith('service-categories')) {
    return Promise.resolve([{ id: 'cat_1', name: 'Hair' }]);
  }
  if (path.startsWith('organization-locations')) {
    return Promise.resolve({ items: LOCATIONS });
  }
  if (path === `practitioners/${PRACTITIONER_ID}`)
    return Promise.resolve(EXISTING);
  if (path.startsWith('practitioners')) {
    return Promise.resolve({ items: [EXISTING], total: 1 });
  }
  return Promise.resolve({ items: [] });
};

// ---------------------------------------------------------------- drive utils

/**
 * Open an editor section by its nav item. The label renders TWICE — the shared
 * editor is one tree whose desktop nav and mobile pills are shown by CSS.
 */
const gotoSection = async (user: UserEvent, label: string) => {
  await user.click(screen.getAllByRole('button', { name: label })[0]);
};

/** Set the file behind whichever hidden `input[type=file]` the surface renders. */
const chooseFile = async (user: UserEvent) => {
  const input = document.querySelector(
    'input[type="file"]'
  ) as HTMLInputElement | null;
  if (!input) throw new Error('no file input behind the photo control');
  await user.upload(input, new File(['x'], 'grace.png', { type: 'image/png' }));
  // Surfaces that crop before uploading (profile panel, wizard photo step) open
  // the crop dialog on select — apply it so the photo actually reaches the
  // payload. Surfaces that upload straight away render no dialog.
  const apply = screen.queryByTestId('image-crop-apply');
  if (apply) await user.click(apply);
};

/**
 * Drive the popover DatePicker: open it, walk to the target month, click the
 * day. Day buttons are labelled with the full date ("Monday, March 2nd, 2026"),
 * so this cannot pick the wrong one.
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

/** Retype a text control located by its visible label. */
const retype = async (user: UserEvent, label: string, value: string) => {
  const el = screen.getByLabelText(label);
  await user.clear(el);
  await user.type(el, value);
};

const putCalls = () =>
  put.mock.calls.filter((c) => c[0] === `practitioners/${PRACTITIONER_ID}`);

// ------------------------------------------------------------------- surfaces

/**
 * The team-member editor. Its photo uploads the moment one is chosen, so the
 * fill waits for the resolved URL; the wizard and setup-profile upload on
 * Continue, so theirs only set the file.
 */
const editorSurface: Surface<Fields> = {
  name: 'unified entity editor (/edit/team-member/:id)',
  owns: [
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
    'title',
    'employmentStartDate',
    'employmentEndDate',
    'employmentType',
    'teamMemberRef',
    'notes',
    'acceptsBookings',
  ],
  fills: {
    photo: async (user) => {
      await chooseFile(user);
      await waitFor(() => expect(uploadAsync).toHaveBeenCalled());
    },
    color: async (user) => {
      await user.click(
        screen.getByRole('button', {
          name: (F.color as { sampleLabel: string }).sampleLabel,
        })
      );
    },
    employmentStartDate: (user) =>
      pickDate(
        user,
        F.employmentStartDate.label,
        sample('employmentStartDate') as string
      ),
    employmentEndDate: (user) =>
      pickDate(
        user,
        F.employmentEndDate.label,
        sample('employmentEndDate') as string
      ),
  },
  run: async (ctx) => {
    renderWithProviders(
      <EntityEditorRoute id={PRACTITIONER_ID} mode="edit" slug="team-member" />
    );
    await screen.findByRole('heading', { name: 'Edit team member' });

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
      'title',
      'employmentStartDate',
      'employmentEndDate',
      'employmentType',
      'teamMemberRef',
      'notes'
    );

    await gotoSection(ctx.user, 'Settings');
    await ctx.fill('acceptsBookings');

    await ctx.user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(putCalls().length).toBeGreaterThan(0));
  },
};

/** The profile dialog. It calls the job title "Title", so it pins its own. */
const dialogSurface: Surface<Fields> = {
  name: 'profile-dialog',
  owns: ['name', 'email', 'phone', 'title', 'bio'],
  fills: {
    title: (user) => retype(user, 'Title', sample('title') as string),
  },
  run: async (ctx) => {
    renderWithProviders(
      <PractitionerDialog
        open
        onOpenChange={() => {}}
        practitioner={EXISTING}
      />
    );
    await ctx.fill('name', 'email', 'phone', 'title', 'bio');
    await ctx.user.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(putCalls().length).toBeGreaterThan(0));
  },
};

/** Onboarding step 1: upload a photo and name your role, then Continue. */
const setupPhotoTitleSurface: Surface<Fields> = {
  name: 'onboarding setup-profile (photo + title)',
  owns: ['photo', 'title'],
  fills: {
    // The upload happens in the step's `onBeforeContinue`, not on select.
    photo: (user) => chooseFile(user),
    title: (user) =>
      retype(user, 'Your title / role', sample('title') as string),
  },
  run: async (ctx) => {
    renderWithProviders(<SetupProfileForm />);
    await screen.findByLabelText('Your title / role');
    await ctx.fill('photo', 'title');
    await ctx.user.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(putCalls().length).toBeGreaterThan(0));
  },
};

/** Onboarding's final submit: the working-hours grid. */
const setupWorkingHoursSurface: Surface<Fields> = {
  name: 'onboarding setup-profile (working hours)',
  owns: ['workingHours'],
  fills: {
    // Seeded Mon–Fri 9–5; switching Friday off is the sample.
    workingHours: async (user) => {
      await user.click(screen.getByLabelText('Toggle Friday'));
    },
  },
  run: async (ctx) => {
    renderWithProviders(<SetupProfileForm />);

    // Step 1 (photo + title) is prefilled from the practitioner; walk past it.
    await screen.findByLabelText('Your title / role');
    await ctx.user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 2 (services) is prefilled with the practitioner's assignments.
    await screen.findByText(/haircut/i);
    await ctx.user.click(screen.getByRole('button', { name: /continue/i }));

    // Step 3 (calendar connect) is skippable.
    await ctx.user.click(screen.getByRole('button', { name: /continue/i }));

    await screen.findByLabelText('Toggle Friday');
    await ctx.fill('workingHours');

    await ctx.user.click(
      screen.getByRole('button', { name: /complete setup/i })
    );
    await waitFor(() => expect(putCalls().length).toBeGreaterThan(1));
  },
};

/** The invited-member wizard PUTs once per step; each step is its own surface. */
const wizardStep = (
  name: string,
  owns: (keyof Fields & string)[],
  opts: { steps: number; fills?: Surface<Fields>['fills'] }
): Surface<Fields> => ({
  name,
  owns,
  fills: opts.fills,
  run: async (ctx) => {
    renderWithProviders(<TeamMemberWizard onComplete={() => {}} />);
    await screen.findByRole('button', { name: /continue/i });

    // Walk to this step's screen. Continuing with nothing entered carries no
    // intent, so the steps we pass through make no PUT of their own.
    for (let i = 0; i < opts.steps; i++) {
      await ctx.user.click(screen.getByRole('button', { name: /continue/i }));
    }

    await ctx.fill(...owns);
    await ctx.user.click(
      screen.getByRole('button', { name: /continue|finish/i })
    );
    await waitFor(() => expect(putCalls().length).toBeGreaterThan(0));
  },
});

runFormContract({
  operation: 'PUT practitioners/:id',
  description: 'Update team member',
  form: updatePractitionerForm,

  surfaces: [
    editorSurface,
    dialogSurface,
    setupPhotoTitleSurface,
    setupWorkingHoursSurface,
    // photo-tips → photo-upload
    wizardStep('team-member-wizard (photo)', ['photo'], {
      steps: 1,
      fills: { photo: (user) => chooseFile(user) },
    }),
    // …→ headline-bio
    wizardStep('team-member-wizard (headline + bio)', ['headline', 'bio'], {
      steps: 2,
    }),
    // …→ languages
    wizardStep('team-member-wizard (languages)', ['languages'], {
      steps: 3,
      fills: {
        languages: async (user) => {
          await user.click(screen.getByRole('button', { name: 'English' }));
        },
      },
    }),
    // …→ social
    wizardStep('team-member-wizard (social links)', ['socialLinks'], {
      steps: 4,
      fills: {
        socialLinks: async (user) => {
          await user.type(screen.getByLabelText('Instagram'), '@ada');
          // A handle left as whitespace must not be persisted — the shared
          // builder drops it, so the sample carries only the Instagram one.
          await user.type(screen.getByLabelText('TikTok'), '   ');
        },
      },
    }),
  ],

  reset: () => {
    uploadAsync.mockReset();
    uploadAsync.mockResolvedValue({ url: sample('photo') });
    post.mockReset();
    post.mockResolvedValue({ id: PRACTITIONER_ID });
    put.mockReset();
    put.mockResolvedValue({ id: PRACTITIONER_ID });
    get.mockReset();
    get.mockImplementation(routeGet);
  },

  /**
   * The LAST `PUT practitioners/:id` of the run — a stepped surface patches its
   * own slice as it goes, and the one under test is the step it stopped on.
   */
  readBody: () => {
    const calls = putCalls();
    if (calls.length === 0) {
      throw new Error('no PUT practitioners/:id call captured');
    }
    return calls[calls.length - 1][1] as Record<string, unknown>;
  },

  // Each surface's body is its own slice — PATCH emits only what it was given.
  expectedBody: (surface) =>
    expectedFromFields(
      updatePractitionerForm.fields,
      {},
      { only: surface.owns }
    ),
});
