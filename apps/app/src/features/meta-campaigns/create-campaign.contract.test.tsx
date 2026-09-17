import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from '@/test/render';
import type { UserEvent } from '@testing-library/user-event';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST meta-campaigns` — create ad campaign.
 *
 * Two layouts build this body — the desktop {@link CreateCampaignDialog} and the
 * mobile {@link CampaignMobileCreate} funnel — and both are presentations of the
 * one shared core (`useCreateCampaignForm` + `buildCreateCampaignPayload`).
 * Neither may assemble a payload itself.
 *
 * A BRANCH IS A SURFACE, so each layout appears twice. The form is a union on
 * "How should leads reach you?": a lead-form campaign renders a `Lead form`
 * picker and no messaging controls; a chatbot campaign renders `destinations` +
 * `Optimization` and no lead form. Each surface owns the slice its branch
 * renders — exempting the other branch's fields would hide exactly the dropped
 * control this exists to catch — and the harness still holds the line that every
 * field is owned by SOME surface.
 *
 * It keeps the regression the shared core was extracted for: the mobile hook
 * used to hardcode `objective = chatbot ? OUTCOME_ENGAGEMENT : OUTCOME_LEADS`,
 * ignoring the desktop-only "Optimization" picker — so a chatbot campaign
 * created on a phone could never be lead-optimized.
 */

// jsdom shims for Radix (dialog, accordion, toggle-group, checkbox) + vaul.
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

// vaul's drag physics read layout jsdom can't provide. Stub the Drawer to a
// minimal `open`-gated passthrough — the mobile funnel's sheets (location,
// lead form) stay real; only the drag/animation shell is replaced.
vi.mock('vaul', async () => {
  const React = await import('react');
  const Ctx = React.createContext<{
    open: boolean;
    setOpen: (v: boolean) => void;
  }>({ open: false, setOpen: () => {} });
  const Root = ({
    children,
    open,
    onOpenChange,
  }: {
    children: React.ReactNode;
    open?: boolean;
    onOpenChange?: (v: boolean) => void;
  }) => (
    <Ctx.Provider value={{ open: !!open, setOpen: (v) => onOpenChange?.(v) }}>
      {children}
    </Ctx.Provider>
  );
  const Trigger = ({ children }: { children: React.ReactNode }) => {
    const { setOpen } = React.useContext(Ctx);
    return (
      // biome-ignore lint/a11y/useKeyWithClickEvents: test-only stub
      <div onClick={() => setOpen(true)}>{children}</div>
    );
  };
  const Portal = ({ children }: { children: React.ReactNode }) => {
    const { open } = React.useContext(Ctx);
    return open ? <>{children}</> : null;
  };
  const Pass = ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  );
  return {
    Drawer: {
      Root,
      Trigger,
      Portal,
      Overlay: Pass,
      Content: Pass,
      Title: Pass,
    },
  };
});

// The Google Places autocomplete is the one thing here that cannot run in jsdom
// (it needs the Maps JS SDK and a key). Stub the leaf: type a place, press the
// button, get a geocoded result — the real component is still the one the
// surfaces must render, so a deleted location field still fails property 2.
vi.mock('@/components/app/city-search', async () => {
  const React = await import('react');
  return {
    CitySearch: ({
      onCitySelect,
    }: {
      onCitySelect: (r: {
        name: string;
        latitude: number;
        longitude: number;
      }) => void;
    }) => {
      const [value, setValue] = React.useState('');
      return (
        <>
          <input
            aria-label="Search for a city, town or area"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
          <button
            type="button"
            onClick={() =>
              onCitySelect({
                name: value,
                latitude: 53.3498,
                longitude: -6.2603,
              })
            }
          >
            Use this city
          </button>
        </>
      );
    },
  };
});

// Radix Popover + cmdk → passthrough, so the desktop lead-form picker's list is
// mounted and clickable in jsdom.
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PopoverTrigger: ({ children }: { children?: React.ReactNode }) => (
    <>{children}</>
  ),
  PopoverContent: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('@/components/ui/command', () => ({
  Command: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandInput: (props: { placeholder?: string }) => (
    <input placeholder={props.placeholder} />
  ),
  CommandList: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandEmpty: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandGroup: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CommandItem: ({
    children,
    onSelect,
  }: {
    children?: React.ReactNode;
    onSelect?: () => void;
  }) => (
    <div
      role="option"
      aria-selected={false}
      tabIndex={0}
      onClick={() => onSelect?.()}
      onKeyDown={() => onSelect?.()}
    >
      {children}
    </div>
  ),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const executeAsync = vi.fn();

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  // Branch-scoped hrefs are read from the pathname (plan §4); see
  // `src/test/render.tsx` for why a router-coupled spec must mock this.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard/l/test-location/home' } }),
}));

vi.mock('@/features/meta-campaigns/api', () => ({
  useCreateCampaign: () => ({ executeAsync, isExecuting: false }),
}));

vi.mock('@/features/integrations/api', () => ({
  useGetMetaIntegration: () => ({
    integration: {
      defaultPageId: 'page-1',
      pages: [
        {
          id: 'page-1',
          isActive: true,
          defaultAdAccountCurrency: 'EUR',
          linkedInstagramAccountId: 'ig-1',
        },
      ],
    },
    isConnected: true,
    isLoading: false,
  }),
  useListWhatsAppAccounts: () => ({ accounts: [{ id: 'wa-1' }] }),
}));

const LEAD_FORM = {
  id: 'lf_1',
  name: 'Consultation Enquiry',
  status: 'synced',
  metaFormId: 'meta_lf_1',
  questions: [{ type: 'FULL_NAME', label: 'Full name' }],
};

vi.mock('@/features/lead-forms', () => ({
  useListLeadForms: () => ({ leadForms: [LEAD_FORM], isLoading: false }),
  CreateLeadFormDialog: () => null,
}));

// No org location, so both surfaces render the real location SEARCH rather than
// the single-location prefill — the path where the user actually picks one.
vi.mock('@/features/organization-locations', () => ({
  useListLocations: () => ({ locations: [], isLoading: false }),
}));

vi.mock('@/features/mobile-dashboard-header', () => ({
  useMobileDashboardHeaderContent: () => undefined,
}));

import { CampaignMobileCreate } from './components/campaign-mobile/campaign-mobile-create';
import { createCampaignForm } from './components/create-campaign-form';
import { CreateCampaignDialog } from './components/create-campaign-modal';

/** Which LAYOUT is mounted — the two present several controls differently. */
let surface: 'desktop' | 'mobile' = 'desktop';

/** The fields both branches render. */
const SHARED = [
  'name',
  'dailyBudget',
  'targetingLocation',
  'targetingDistanceKm',
] as const;

/** The lead-form branch: a lead form, and no messaging controls at all. */
const LEAD_FORM_BRANCH = [...SHARED, 'leadFormId'] as const;

/**
 * The chatbot branch: the follow-up switch itself (the lead-form branch is where
 * the form STARTS, so only this one sets it), the messaging destinations, and the
 * Lead Generation / Engagement optimization Meta needs.
 */
const CHATBOT_BRANCH = [
  ...SHARED,
  'followUpType',
  'destinations',
  'optimizationMode',
] as const;

const F = createCampaignForm.fields;
const sampleOf = <T,>(key: keyof typeof F): T => {
  const entry = F[key];
  if ('exempt' in entry) throw new Error(`${String(key)} is exempt`);
  return entry.sample as T;
};

const mountDesktop = async () => {
  surface = 'desktop';
  renderWithProviders(
    <CreateCampaignDialog open onOpenChange={() => undefined} />
  );
  await screen.findByRole('dialog');
};

const mountMobile = () => {
  surface = 'mobile';
  renderWithProviders(<CampaignMobileCreate />);
};

const submitDesktop = async (user: UserEvent) => {
  await user.click(screen.getByRole('button', { name: 'Create campaign' }));
  await waitFor(() => expect(executeAsync).toHaveBeenCalled());
};

const submitMobile = async (user: UserEvent) => {
  await user.click(screen.getByRole('button', { name: 'Publish Campaign' }));
  await waitFor(() => expect(executeAsync).toHaveBeenCalled());
};

runFormContract({
  operation: 'POST meta-campaigns',
  description: 'Create ad campaign',
  form: createCampaignForm,

  fills: {
    /** Radio cards (desktop) vs a button pair (mobile) — same shared copy. */
    followUpType: async (user) => {
      await user.click(screen.getByText('Leads should message us'));
    },

    /**
     * Desktop: a combobox of synced lead forms. Mobile: a row that opens a
     * bottom sheet. Both must be filled while the campaign is still lead-form.
     */
    leadFormId: async (user) => {
      if (surface === 'mobile') {
        await user.click(screen.getByText('Select a lead form'));
      }
      const option = await screen.findByText(LEAD_FORM.name);
      await user.click(option);
    },

    /** Messenger is preselected when the campaign turns chatbot; add Instagram. */
    destinations: async (user) => {
      if (surface === 'mobile') {
        const tabs = screen.getByRole('tablist', {
          name:
            F.destinations && 'label' in F.destinations
              ? F.destinations.label
              : undefined,
        });
        await user.click(within(tabs).getByRole('tab', { name: 'Instagram' }));
        return;
      }
      await user.click(screen.getByLabelText('Instagram DM'));
    },

    /** Desktop keeps the picker behind "Advanced settings"; mobile is inline. */
    optimizationMode: async (user) => {
      if (surface === 'desktop') {
        await user.click(
          screen.getByRole('button', { name: /advanced settings/i })
        );
      }
      await user.click(await screen.findByText('Engagement'));
    },

    /**
     * A geocoding search: desktop inline, mobile inside the location sheet
     * (which the radius fill below then types into, so it is left open).
     */
    targetingLocation: async (user) => {
      if (surface === 'mobile') {
        await user.click(screen.getByRole('button', { name: 'Location' }));
      }
      const input = await screen.findByLabelText(
        'Search for a city, town or area'
      );
      await user.type(input, sampleOf<string>('targetingLocation'));
      await user.click(screen.getByRole('button', { name: 'Use this city' }));
    },

    /**
     * `user.clear()` cannot empty an `input[type=number]` bound to a react-hook-form
     * Controller (user-event has no caret/selection for number inputs, so a clear
     * silently no-ops and a type APPENDS: 25 + "40" = 2540). Set the value the way
     * the browser would, then let React's onChange do the rest.
     */
    targetingDistanceKm: async (user) => {
      const radius = await screen.findByLabelText('Radius');
      await user.click(radius);
      fireEvent.change(radius, {
        target: { value: String(sampleOf<number>('targetingDistanceKm')) },
      });
      if (surface === 'mobile') {
        await user.click(screen.getByRole('button', { name: 'Done' }));
      }
    },
  },

  surfaces: [
    {
      name: 'desktop create-campaign-modal (lead form)',
      owns: [...LEAD_FORM_BRANCH],
      run: async (ctx) => {
        await mountDesktop();
        await ctx.fill(...LEAD_FORM_BRANCH);
        await submitDesktop(ctx.user);
      },
    },
    {
      name: 'desktop create-campaign-modal (chatbot)',
      owns: [...CHATBOT_BRANCH],
      run: async (ctx) => {
        await mountDesktop();
        await ctx.fill('name', 'dailyBudget', 'followUpType');
        await ctx.fill('destinations', 'optimizationMode');
        await ctx.fill('targetingLocation', 'targetingDistanceKm');
        await submitDesktop(ctx.user);
      },
    },
    {
      name: 'mobile campaign-create funnel (lead form)',
      owns: [...LEAD_FORM_BRANCH],
      run: async (ctx) => {
        mountMobile();
        await ctx.fill(...LEAD_FORM_BRANCH);
        await submitMobile(ctx.user);
      },
    },
    {
      name: 'mobile campaign-create funnel (chatbot)',
      owns: [...CHATBOT_BRANCH],
      run: async (ctx) => {
        mountMobile();
        await ctx.fill('name', 'dailyBudget', 'followUpType');
        await ctx.fill('destinations', 'optimizationMode');
        await ctx.fill('targetingLocation', 'targetingDistanceKm');
        await submitMobile(ctx.user);
      },
    },
  ],

  reset: () => {
    executeAsync.mockReset();
    executeAsync.mockResolvedValue({ metaCampaignId: 'camp-1' });
  },

  readBody: () => {
    const call = executeAsync.mock.calls[0];
    if (!call) throw new Error('no create-campaign mutation captured');
    return call[0] as Record<string, unknown>;
  },

  /**
   * The branch's samples, plus everything the shared builder derives:
   *   - `dailyBudget` typed in major units → minor units on the wire,
   *   - the follow-up + optimization choices → one Meta `objective`
   *     (chatbot + Engagement → OUTCOME_ENGAGEMENT; a lead form is always
   *     OUTCOME_LEADS),
   *   - the geocoded location + radius → the nested `targeting` block,
   *   - `metaAdsPageId` from the org's default active Page,
   *   - `conversionDestination`, stamped only for chatbot campaigns.
   */
  expectedBody: (surfaceUnderTest) => {
    const isChatbot = surfaceUnderTest.name.includes('chatbot');
    return expectedFromFields(
      createCampaignForm.fields,
      {
        dailyBudget: 2550,
        metaAdsPageId: 'page-1',
        targeting: {
          location: 'Dublin',
          latitude: 53.3498,
          longitude: -6.2603,
          distanceKm: 40,
          ageMin: 18,
          ageMax: 65,
        },
        ...(isChatbot
          ? {
              objective: 'OUTCOME_ENGAGEMENT',
              conversionDestination: 'messenger',
            }
          : { objective: 'OUTCOME_LEADS', followUpType: 'lead_form' }),
      },
      { only: surfaceUnderTest.owns }
    );
  },
});
