import { expectedFromFields, isField } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `PATCH organization/active` — organization settings.
 *
 * ONE operation, ONE field declaration, SEVEN surfaces that each own a DISJOINT
 * slice of it. That is not a modelling compromise — it is what the app does:
 * `buildUpdateOrganizationPayload` emits only the keys present on the intent,
 * precisely so the details page patches the name and URLs while the style page
 * patches the logo and brand colours, and neither clobbers the other.
 *
 * So each surface declares `owns`, and the harness holds the two lines that
 * actually matter:
 *   - EVERY declared field is owned by at least one surface. A control that
 *     falls off all seven is still the dropped-field bug and still fails here;
 *     ownership narrows WHICH surface must render a field, never whether any
 *     must.
 *   - Where two surfaces own the SAME field they must send it identically —
 *     `name` from the details route vs the details tab, the brand colours from
 *     the style route vs the branding tab. That is the drift worth catching, and
 *     it is what the old `update-organization-parity.test.tsx` existed for.
 *
 * The strict-partial-body assertion that spec also carried (the details tab must
 * emit ONLY `name`, never a stray brand key) is preserved by the
 * `only:` narrowing below: `expectedBody` is an exact `toEqual`, so a surface
 * that leaked a field it does not own would fail property 3.
 *
 * The bookings tab appears TWICE, because it is really two forms: the deposit
 * policy is only reachable in "Borradh Calendar" mode and the booking URL only
 * in "Booking Link" mode. Registering one mode would have orphaned the other's
 * fields — and an orphaned field is the bug this harness exists to catch.
 */

// jsdom shims for Radix Select / Slider / Popover.
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
URL.createObjectURL ??= (() => 'blob:logo') as never;
URL.revokeObjectURL ??= (() => {}) as never;

const ORG = {
  id: 'org-1',
  name: 'Acme',
  logo: null,
  websiteUrl: null,
  privacyPolicyUrl: null,
  videoMusicVolume: 0.05,
  stylePreference: 'clean',
  brandStyleGuide: 'Legacy guide',
  primaryCalendarType: 'borradh',
  bookingDestination: 'borradh',
  defaultBookingLink: null,
  depositEnabled: false,
  depositAmount: null,
  // OFF so the switch driver has a real toggle to perform (sample: true) —
  // which also reveals the rescheduling-notice slider for its keyboard fill.
  customerReschedulingEnabled: false,
  // Deliberately NOT the form's own default (24), so a surface's `reset` from
  // server data is observable. Slider fill is one ArrowRight over the hydrated
  // value, so 12 → 13 must equal the field's `sample`.
  reschedulingNoticeRequiredHours: 12,
  noShowOrLateCancelFeeCents: null,
  // OFF so the switch driver has a real toggle to perform (sample: true) —
  // which also reveals the notice slider for its keyboard fill.
  customerCancellationsEnabled: false,
  // NOT the form default (0): the slider fill is one ArrowRight over the
  // hydrated value, so 12 → 13 must equal the field's `sample`.
  cancellationNoticeRequiredHours: 12,
  contributeToAggregateInsights: true,
};

const BRAND = { primaryColor: '#010203', secondaryColor: '#040506' };

/** What the logo upload returns — the URL that actually reaches the wire. */
const LOGO_URL = 'https://cdn.test/uploads/logo.png';

const patch = vi.fn();
const get = vi.fn(async (url: string) => {
  if (url === 'organization/active') return ORG;
  if (url === `organizations/${ORG.id}/brand`) return BRAND;
  if (url === `organizations/${ORG.id}`) return ORG;
  return null;
});

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...(args as [string])),
    patch: (...args: unknown[]) => patch(...args),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('@/features/upload', () => ({
  useUploadImage: () => ({
    uploadAsync: vi.fn().mockResolvedValue({ url: LOGO_URL }),
  }),
}));

// Colour extraction reads pixels off a canvas; jsdom has none. It is best-effort
// in the component (try/catch) and only seeds `primaryColor` when it is still
// the untouched default — which it never is by the time we pick a file.
vi.mock('@/lib/extract-colors', () => ({
  extractColorsFromImage: vi
    .fn()
    .mockResolvedValue({ dominantColor: '#999999' }),
}));

import {
  BookingsTab,
  BrandingTab,
  DetailsTab,
  PrivacyTab,
} from '@/components/app/org-settings/tabs';
import { updateOrganizationForm } from '@/features/organization/api/update-organization/update-organization.form';
import { DetailsCard } from '@/routes/_authed/dashboard/settings/details';
import { StyleSettingsCard } from '@/routes/_authed/dashboard/settings/style';

const L = updateOrganizationForm.labels;

/** Wait for a surface's `reset(serverData)` to land before typing into it. */
const awaitHydration = async (label: string, value: string | number) =>
  waitFor(() => expect(screen.getByLabelText(label)).toHaveValue(value));

/**
 * Bookings-tab hydration anchor. The rescheduling/cancellation notice fields
 * are now sliders gated behind their toggles, so there is no value-bearing
 * input to await. The rescheduling switch reflects the server value (OFF) once
 * `reset(serverData)` lands — it starts from the form default (ON), so waiting
 * for it to be unchecked proves the reset landed before the harness types.
 */
const awaitReschedulingHydration = async () =>
  waitFor(() =>
    expect(
      screen.getByRole('switch', { name: L.customerReschedulingEnabled })
    ).not.toBeChecked()
  );

/**
 * One `defineForm` field has one CANONICAL label, but a surface may reach that
 * field through a control its own copy labels differently — the dialog says
 * "Organization Name" and "Brand Primary Color" where the settings routes say
 * "Organisation name" and "Primary colour". Restyling the dialog to match would
 * be a product decision (it flips US spelling to UK), and a test refactor does
 * not get to make one.
 *
 * So those surfaces reach the field through a surface-scoped `fills` override
 * that locates THEIR control by THEIR visible label. It is still a real control,
 * located by label, seeded with the field's own `sample` — so property 2 keeps
 * its teeth: delete the input and this throws exactly as the generic driver would.
 */
const sampleOf = (key: keyof typeof updateOrganizationForm.fields): string => {
  const field = updateOrganizationForm.fields[key];
  if (!isField(field)) throw new Error(`${String(key)} is exempt — no sample`);
  return String(field.sample);
};

const retypeBy =
  (label: string, key: keyof typeof updateOrganizationForm.fields) =>
  async (user: import('@testing-library/user-event').UserEvent) => {
    const el = screen.getByLabelText(label);
    await user.clear(el);
    await user.type(el, sampleOf(key));
  };

const submit = async (
  user: import('@testing-library/user-event').UserEvent,
  name: RegExp
) => {
  await user.click(screen.getByRole('button', { name }));
  await waitFor(() => expect(patch).toHaveBeenCalled());
};

/**
 * Keys a surface's body carries that the USER did not fill on it: a value the
 * builder derives (major units → cents), or the other branch's constant (in
 * Borradh-calendar mode the booking link is cleared to `null` by definition).
 * Spelled out so property 3 stays an exact `toEqual` — nothing is waved through.
 */
const DERIVED: Record<string, Record<string, unknown>> = {
  'settings/style route': { logo: LOGO_URL },
  'org-settings bookings tab (Borradh calendar)': {
    bookingDestination: 'borradh',
    defaultBookingLink: null,
    depositAmount: 2500, // £25 entered → cents
    noShowOrLateCancelFeeCents: 1500, // £15 entered → cents
  },
  'org-settings bookings tab (external booking link)': {
    bookingDestination: 'external_link',
    depositEnabled: false,
    depositAmount: 0,
    // Hydrated OFF and not owned by this surface, so the rescheduling toggle is
    // sent as-is; the rescheduling notice hours ride along on the same
    // (always-sent) rescheduling-policy branch.
    customerReschedulingEnabled: false,
    reschedulingNoticeRequiredHours: ORG.reschedulingNoticeRequiredHours,
    noShowOrLateCancelFeeCents: null,
    // Hydrated OFF and not owned by this surface, so the toggle is sent as-is
    // and the notice hours are withheld (only sent while cancellations are ON).
    customerCancellationsEnabled: false,
  },
};

runFormContract({
  operation: 'PATCH organization',
  description: 'Update organization settings',
  form: updateOrganizationForm,

  fills: {
    // The logo is an avatar + a hidden file input, and the value that reaches
    // the wire is whatever the UPLOAD returns — not anything typed.
    logo: async (user) => {
      const input = screen.getByLabelText(L.logo);
      await user.upload(
        input,
        new File(['logo-bytes'], 'logo.png', { type: 'image/png' })
      );
    },
    // A 0-100 slider over a 0-1 value. Focus the thumb and step it — clicking it
    // would set the value from the pointer's (meaningless, always-0) coordinates.
    videoMusicVolume: async (user) => {
      // Radix puts role="slider" on the THUMB, while the label/aria-label sit on
      // the root — so this locates by role. The style route renders exactly one.
      const slider = screen.getByRole('slider');
      slider.focus();
      await user.keyboard('{ArrowRight}'); // 5% → 6% == 0.06
    },
    // The 0-48h rescheduling-notice slider. Only rendered once the
    // customer-rescheduling switch (filled first — `owns` order) is ON. At this
    // point in the fill sequence the cancellations switch is still OFF, so this
    // is the only slider on the bookings tab.
    reschedulingNoticeRequiredHours: async (user) => {
      const slider = await screen.findByRole('slider');
      slider.focus();
      await user.keyboard('{ArrowRight}'); // 12h → 13h == sample
    },
    // The 0-48h cancellation-notice slider. Only rendered once the
    // customer-cancellations switch (filled first — `owns` order) is ON. By now
    // the rescheduling switch is also ON, so TWO sliders are on the tab — the
    // cancellation one renders second in the DOM, so take the last.
    cancellationNoticeRequiredHours: async (user) => {
      const sliders = await screen.findAllByRole('slider');
      const slider = sliders[sliders.length - 1];
      slider.focus();
      await user.keyboard('{ArrowRight}'); // 12h → 13h == sample
    },
  },

  surfaces: [
    {
      name: 'settings/details route',
      owns: ['name', 'websiteUrl', 'privacyPolicyUrl'],
      run: async (ctx) => {
        renderWithProviders(<DetailsCard />);
        await awaitHydration(L.name, ORG.name);
        await ctx.fillRest();
        await submit(ctx.user, /save changes/i);
      },
    },
    {
      name: 'org-settings details tab',
      owns: ['name'],
      // This dialog labels the same field "Organization Name".
      fills: { name: retypeBy('Organization Name', 'name') },
      run: async (ctx) => {
        renderWithProviders(<DetailsTab />);
        await awaitHydration('Organization Name', ORG.name);
        await ctx.fillRest();
        await submit(ctx.user, /^submit$/i);
      },
    },
    {
      name: 'settings/style route',
      // `logo` LAST: picking a file best-effort seeds the primary colour, but
      // only while it is still untouched — so colour first, then logo.
      owns: [
        'primaryColor',
        'secondaryColor',
        'videoMusicVolume',
        'stylePreference',
        'brandStyleGuide',
        'logo',
      ],
      run: async (ctx) => {
        renderWithProviders(<StyleSettingsCard />);
        await awaitHydration(L.primaryColor, BRAND.primaryColor);
        await ctx.fillRest();
        await submit(ctx.user, /save changes/i);
      },
    },
    {
      name: 'org-settings branding tab',
      owns: ['primaryColor', 'secondaryColor'],
      // This dialog labels the brand colours "Brand Primary/Secondary Color".
      fills: {
        primaryColor: retypeBy('Brand Primary Color', 'primaryColor'),
        secondaryColor: retypeBy('Brand Secondary Color', 'secondaryColor'),
      },
      run: async (ctx) => {
        renderWithProviders(<BrandingTab />);
        await awaitHydration('Brand Primary Color', BRAND.primaryColor);
        await ctx.fillRest();
        await submit(ctx.user, /^submit$/i);
      },
    },
    {
      name: 'org-settings bookings tab (Borradh calendar)',
      // `depositEnabled` before `depositAmount` — the amount only exists once
      // deposits are switched on.
      owns: [
        'bookingDestination',
        'depositEnabled',
        // Order matters twice over: the amounts only exist once deposits are
        // switched ON, and only ONE amount renders at a time — the fixed input
        // while the basis is `fixed`, the percent input once it flips. So fill
        // the fixed amount first, then switch the basis, then the percentage.
        'depositAmount',
        'defaultDepositBasis',
        'defaultDepositPercent',
        // Switch BEFORE slider: the rescheduling-notice slider only renders
        // once customer rescheduling is toggled on.
        'customerReschedulingEnabled',
        'reschedulingNoticeRequiredHours',
        'noShowOrLateCancelFeeCents',
        // Switch BEFORE slider: the notice slider only renders once customer
        // cancellations are toggled on.
        'customerCancellationsEnabled',
        'cancellationNoticeRequiredHours',
      ],
      run: async (ctx) => {
        renderWithProviders(<BookingsTab />);
        await awaitReschedulingHydration();
        await ctx.fillRest();
        await submit(ctx.user, /^submit$/i);
      },
    },
    {
      name: 'org-settings bookings tab (external booking link)',
      owns: ['defaultBookingLink'],
      run: async (ctx) => {
        renderWithProviders(<BookingsTab />);
        await awaitReschedulingHydration();
        // The other branch of the same tab: the booking URL exists only here.
        await ctx.user.click(
          screen.getByRole('radio', { name: /booking link/i })
        );
        await ctx.fillRest();
        await submit(ctx.user, /^submit$/i);
      },
    },
    {
      name: 'org-settings privacy tab',
      owns: ['contributeToAggregateInsights'],
      run: async (ctx) => {
        renderWithProviders(<PrivacyTab />);
        await screen.findByRole('switch', {
          name: L.contributeToAggregateInsights,
        });
        // No form and no submit: the switch writes on change.
        await ctx.fillRest();
        await waitFor(() => expect(patch).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    patch.mockReset();
    patch.mockResolvedValue({ ...ORG });
  },

  readBody: () => {
    const call = patch.mock.calls.find((c) => c[0] === 'organization/active');
    if (!call) throw new Error('no PATCH organization/active call captured');
    return call[1] as Record<string, unknown>;
  },

  expectedBody: (surface) =>
    expectedFromFields(updateOrganizationForm.fields, DERIVED[surface.name], {
      only: surface.owns,
    }),
});
