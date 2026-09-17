import { renderWithProviders, screen, waitFor, within } from '@/test/render';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Integration test for the Settings > Organisation details website scan
 * (ENG-659) — the whole dialog, driven the way an owner drives it.
 *
 * `plan-selection.test.ts` already covers the pure key/mode arithmetic. What it
 * cannot cover is the WIRING: that the section checklist reaches
 * `analyze/start` as `scanFor`, that the plan the API returns becomes the
 * checkboxes the owner ticks, and that those ticks come back out as the exact
 * `{ modes, deselected }` body `POST website-analysis/apply` receives. Every
 * assertion below is on a real request payload or on rendered output.
 *
 * REAL: the dialog, PlanReview/PlanSection, the React Query hooks, the
 * selection state machine.
 * MOCKED: `apiClient` (the four endpoints), `sonner`, and `useOrgCurrency`
 * (it fetches locations purely to pick a currency symbol — not this unit).
 */

const get = vi.fn();
const post = vi.fn();

vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
const toastWarning = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

// The dialog reads only `currency.symbol` off this; the hook itself fetches
// locations, which has nothing to do with the scan.
vi.mock('@/hooks/use-org-currency', () => ({
  useOrgCurrency: () => ({
    currency: { symbol: '€', code: 'EUR' },
    format: (cents: number) => `€${(cents / 100).toFixed(2)}`,
  }),
}));

import { WebsiteScanDialog } from './website-scan-dialog';

const JOB_ID = 'wa:job-123';

/** A plan in the shape `POST website-analysis/preview` returns. */
const aPlan = (over: Record<string, unknown> = {}) => ({
  scanned: [
    'services',
    'packages',
    'description',
    'location',
    'hours',
    'team',
    'brand',
  ],
  services: {
    create: [
      {
        key: 'service.create:hydrafacial',
        name: 'Hydrafacial',
        priceType: 'fixed',
        priceCents: 9000,
      },
      {
        key: 'service.create:led mask',
        name: 'LED Mask',
        priceType: 'fixed',
        priceCents: 4000,
      },
    ],
    priceChanges: [],
    notFound: [],
    unchanged: 0,
  },
  packages: { create: [], notFound: [], blocked: [] },
  team: { create: [], notFound: [] },
  locations: { create: [], blocked: [], matched: 0 },
  description: { locationId: null, current: null, scanned: null },
  hours: { current: null, scanned: null },
  brand: { current: {}, scanned: {} },
  ...over,
});

const anApplySummary = (over: Record<string, unknown> = {}) => ({
  createdServiceIds: ['svc_1'],
  servicesPriceUpdated: 0,
  servicesDeactivated: 0,
  locationsCreated: 0,
  venueDescriptionUpdated: false,
  openingHoursUpdated: false,
  brandUpdated: false,
  practitionersCreated: 0,
  practitionersDeactivated: 0,
  packagesCreated: 0,
  packagesDeactivated: 0,
  skipped: [],
  ...over,
});

/**
 * Wire the four endpoints. `job` is served for the poll, `plan` for the
 * preview, `summary` for the apply — each overridable per test.
 */
const wireApi = (
  opts: {
    job?: Record<string, unknown>;
    plan?: Record<string, unknown>;
    summary?: Record<string, unknown>;
    applyRejects?: Error;
  } = {}
) => {
  get.mockImplementation((url: string) => {
    if (url.startsWith('website-analysis/analyze/')) {
      return Promise.resolve(
        opts.job ?? { status: 'done', phase: 'done', jobId: JOB_ID }
      );
    }
    return Promise.resolve({ items: [] });
  });

  post.mockImplementation((url: string) => {
    if (url === 'website-analysis/analyze/start') {
      return Promise.resolve({ jobId: JOB_ID });
    }
    if (url === 'website-analysis/preview') {
      return Promise.resolve(opts.plan ?? aPlan());
    }
    if (url === 'website-analysis/apply') {
      if (opts.applyRejects) return Promise.reject(opts.applyRejects);
      return Promise.resolve(opts.summary ?? anApplySummary());
    }
    return Promise.resolve({});
  });
};

const bodyOf = (url: string) => {
  const call = post.mock.calls.find((c) => c[0] === url);
  if (!call) throw new Error(`no POST to ${url}`);
  return call[1] as Record<string, unknown>;
};

/** Open the dialog and run a scan through to the review step. */
const scanToReview = async (
  user: ReturnType<typeof userEvent.setup>,
  { websiteUrl = 'https://clinic.ie' } = {}
) => {
  renderWithProviders(<WebsiteScanDialog websiteUrl={websiteUrl} />);
  await user.click(screen.getByRole('button', { name: /scan my website/i }));
  const dialog = await screen.findByRole('dialog');
  await user.click(
    within(dialog).getByRole('button', { name: /^scan my website$/i })
  );
  await screen.findByText(/review what we found/i);
  return dialog;
};

beforeEach(() => {
  vi.clearAllMocks();
  wireApi();
});

describe('WebsiteScanDialog', () => {
  describe('choosing what to scan', () => {
    it('asks for every section by default', async () => {
      const user = userEvent.setup();
      await scanToReview(user);

      expect(bodyOf('website-analysis/analyze/start')).toEqual(
        expect.objectContaining({
          websiteUrl: 'https://clinic.ie',
          // A rescan must never be served an earlier scan's cached result.
          forceRefresh: true,
          scanFor: expect.arrayContaining([
            'services',
            'packages',
            'description',
            'location',
            'hours',
            'team',
            'brand',
          ]),
        })
      );
    });

    it('narrows the scan itself, not just what gets applied', async () => {
      // scanFor narrows the PROMPT — a scan that never asks for packages
      // cannot come back having invented one. So the checklist has to reach
      // the wire, not merely filter the diff afterwards.
      const user = userEvent.setup();
      renderWithProviders(<WebsiteScanDialog websiteUrl="https://clinic.ie" />);
      await user.click(
        screen.getByRole('button', { name: /scan my website/i })
      );
      const dialog = await screen.findByRole('dialog');

      // Untick everything except services.
      for (const section of [
        'packages',
        'description',
        'location',
        'hours',
        'team',
        'brand',
      ]) {
        const box = document.getElementById(`scan-${section}`);
        if (box && box.getAttribute('data-state') === 'checked') {
          await user.click(box);
        }
      }

      await user.click(
        within(dialog).getByRole('button', { name: /^scan my website$/i })
      );
      await screen.findByText(/review what we found/i);

      expect(bodyOf('website-analysis/analyze/start').scanFor).toEqual([
        'services',
      ]);
    });

    it('warns that packages drag services along', async () => {
      const user = userEvent.setup();
      renderWithProviders(<WebsiteScanDialog websiteUrl="https://clinic.ie" />);
      await user.click(
        screen.getByRole('button', { name: /scan my website/i })
      );
      await screen.findByRole('dialog');

      const services = document.getElementById('scan-services');
      if (services) await user.click(services);

      expect(
        await screen.findByText(/services will be scanned too/i)
      ).toBeInTheDocument();
    });

    it('cannot start a scan with nothing selected', async () => {
      const user = userEvent.setup();
      renderWithProviders(<WebsiteScanDialog websiteUrl="https://clinic.ie" />);
      await user.click(
        screen.getByRole('button', { name: /scan my website/i })
      );
      const dialog = await screen.findByRole('dialog');

      for (const section of [
        'services',
        'packages',
        'description',
        'location',
        'hours',
        'team',
        'brand',
      ]) {
        const box = document.getElementById(`scan-${section}`);
        if (box && box.getAttribute('data-state') === 'checked') {
          await user.click(box);
        }
      }

      expect(
        within(dialog).getByRole('button', { name: /^scan my website$/i })
      ).toBeDisabled();
      expect(post).not.toHaveBeenCalledWith(
        'website-analysis/analyze/start',
        expect.anything()
      );
    });

    it('refuses to scan when the account has no website saved', async () => {
      const user = userEvent.setup();
      renderWithProviders(<WebsiteScanDialog websiteUrl="   " />);
      await user.click(
        screen.getByRole('button', { name: /scan my website/i })
      );
      const dialog = await screen.findByRole('dialog');

      await user.click(
        within(dialog).getByRole('button', { name: /^scan my website$/i })
      );

      expect(toastError).toHaveBeenCalledWith(
        expect.stringMatching(/website address/i)
      );
      expect(post).not.toHaveBeenCalledWith(
        'website-analysis/analyze/start',
        expect.anything()
      );
    });
  });

  describe('review → apply', () => {
    it('applies every additive row when the owner changes nothing', async () => {
      const user = userEvent.setup();
      const dialog = await scanToReview(user);

      // Two services found, both ticked by default.
      expect(
        within(dialog).getByRole('button', { name: /apply 2 changes/i })
      ).toBeEnabled();
      expect(screen.getByText(/2 of 2 changes selected/i)).toBeInTheDocument();

      await user.click(
        within(dialog).getByRole('button', { name: /apply 2 changes/i })
      );

      await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
      const body = bodyOf('website-analysis/apply');
      expect(body.jobId).toBe(JOB_ID);
      expect(body.deselected).toEqual([]);
      expect(body.modes).toEqual(expect.objectContaining({ services: 'add' }));
    });

    it('sends the un-ticked row as a deselection, keying it by the server key', async () => {
      const user = userEvent.setup();
      const dialog = await scanToReview(user);

      await user.click(
        document.getElementById('row-service.create:led mask') as HTMLElement
      );

      expect(
        within(dialog).getByRole('button', { name: /apply 1 change$/i })
      ).toBeEnabled();

      await user.click(
        within(dialog).getByRole('button', { name: /apply 1 change$/i })
      );

      await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
      const body = bodyOf('website-analysis/apply');
      expect(body.deselected).toEqual(['service.create:led mask']);
      expect(body.modes).toEqual(expect.objectContaining({ services: 'add' }));
    });

    it('never proposes a switch-off the owner did not ask for', async () => {
      // The lossiest thing an apply can do, so it is opt-in one row at a time:
      // a not-found row renders, but unticked, and the request stays additive.
      const user = userEvent.setup();
      wireApi({
        plan: aPlan({
          services: {
            create: [],
            priceChanges: [],
            notFound: [
              {
                key: 'service.deactivate:svc_1',
                id: 'svc_1',
                name: 'Retired Offer',
              },
            ],
            unchanged: 0,
          },
        }),
      });
      const dialog = await scanToReview(user);

      expect(screen.getByText('Retired Offer')).toBeInTheDocument();
      expect(
        document.getElementById('row-service.deactivate:svc_1')
      ).toHaveAttribute('data-state', 'unchecked');
      // Nothing ticked → nothing to apply.
      expect(
        within(dialog).getByRole('button', { name: /apply 0 changes/i })
      ).toBeDisabled();
    });

    it('derives replace from ticking a switch-off row', async () => {
      const user = userEvent.setup();
      wireApi({
        plan: aPlan({
          services: {
            create: [],
            priceChanges: [],
            notFound: [
              {
                key: 'service.deactivate:svc_1',
                id: 'svc_1',
                name: 'Retired Offer',
              },
            ],
            unchanged: 0,
          },
        }),
        summary: anApplySummary({
          createdServiceIds: [],
          servicesDeactivated: 1,
        }),
      });
      const dialog = await scanToReview(user);

      await user.click(
        document.getElementById('row-service.deactivate:svc_1') as HTMLElement
      );

      await user.click(
        within(dialog).getByRole('button', { name: /apply 1 change$/i })
      );

      await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
      const body = bodyOf('website-analysis/apply');
      expect(body.modes).toEqual(
        expect.objectContaining({ services: 'replace' })
      );
      expect(body.deselected).toEqual([]);
    });

    it('turns a whole untouched section into ignore rather than a full deselection', async () => {
      const user = userEvent.setup();
      wireApi({
        plan: aPlan({
          team: {
            create: [{ key: 'team.create:anna kelly', name: 'Anna Kelly' }],
            notFound: [],
          },
        }),
      });
      const dialog = await scanToReview(user);

      // Untick both services, leave the team row ticked.
      await user.click(
        document.getElementById('row-service.create:hydrafacial') as HTMLElement
      );
      await user.click(
        document.getElementById('row-service.create:led mask') as HTMLElement
      );

      await user.click(
        within(dialog).getByRole('button', { name: /apply 1 change$/i })
      );

      await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
      const body = bodyOf('website-analysis/apply');
      expect(body.modes).toEqual(
        expect.objectContaining({ services: 'ignore', team: 'add' })
      );
    });

    it('maps the value sections to apply / ignore', async () => {
      const user = userEvent.setup();
      wireApi({
        plan: aPlan({
          services: {
            create: [],
            priceChanges: [],
            notFound: [],
            unchanged: 0,
          },
          description: {
            locationId: 'loc_1',
            current: null,
            scanned: 'A calm clinic on the quays.',
          },
          hours: { current: null, scanned: { '1': { from: 540, to: 1020 } } },
        }),
      });
      const dialog = await scanToReview(user);

      // Both value rows tick by default; drop the hours one.
      await user.click(
        document.getElementById('row-value.hours') as HTMLElement
      );

      await user.click(
        within(dialog).getByRole('button', { name: /apply 1 change$/i })
      );

      await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
      expect(bodyOf('website-analysis/apply').modes).toEqual(
        expect.objectContaining({ description: 'apply', hours: 'ignore' })
      );
    });

    it('reports what was left alone', async () => {
      const user = userEvent.setup();
      wireApi({
        summary: anApplySummary({
          skipped: ['Skipped the package "Phantom Bundle" — unresolved item'],
        }),
      });
      const dialog = await scanToReview(user);

      await user.click(
        within(dialog).getByRole('button', { name: /apply 2 changes/i })
      );

      await waitFor(() => expect(toastWarning).toHaveBeenCalled());
      expect(toastWarning).toHaveBeenCalledWith(
        expect.stringMatching(/1 item was left alone/i),
        expect.objectContaining({
          description: expect.stringContaining('Phantom Bundle'),
        })
      );
    });
  });

  describe('states that must not offer an apply', () => {
    it('refuses the review when the API is too old to key its rows', async () => {
      // A frontend briefly AHEAD of the API gets rows with no `key`: every
      // checkbox then collapses onto one identity and a single click toggles
      // the whole plan, while the old API ignores `deselected` entirely. Both
      // failures are silent, so the only honest answer is to refuse.
      const user = userEvent.setup();
      wireApi({
        plan: aPlan({
          services: {
            create: [
              { name: 'Hydrafacial', priceType: 'fixed', priceCents: 9000 },
            ],
            priceChanges: [],
            notFound: [],
            unchanged: 0,
          },
        }),
      });
      const dialog = await scanToReview(user);

      expect(
        screen.getByText(/without the identifiers the review needs/i)
      ).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('button', { name: /^apply/i })
      ).toBeDisabled();
    });

    it('says so plainly when the account already matches the site', async () => {
      const user = userEvent.setup();
      wireApi({
        plan: aPlan({
          services: {
            create: [],
            priceChanges: [],
            notFound: [],
            unchanged: 7,
          },
        }),
      });
      const dialog = await scanToReview(user);

      expect(
        screen.getByText(/already matches your website/i)
      ).toBeInTheDocument();
      expect(
        within(dialog).getByRole('button', { name: /^apply/i })
      ).toBeDisabled();
    });

    it('surfaces the scan failure instead of a review', async () => {
      const user = userEvent.setup();
      wireApi({
        job: {
          status: 'error',
          phase: 'error',
          error:
            'Website analysis timed out. You can fill in the details manually.',
        },
      });
      renderWithProviders(<WebsiteScanDialog websiteUrl="https://clinic.ie" />);
      await user.click(
        screen.getByRole('button', { name: /scan my website/i })
      );
      const dialog = await screen.findByRole('dialog');
      await user.click(
        within(dialog).getByRole('button', { name: /^scan my website$/i })
      );

      expect(
        await screen.findByText(/Website analysis timed out/i)
      ).toBeInTheDocument();
      // No preview was ever requested for a failed scan.
      expect(post).not.toHaveBeenCalledWith(
        'website-analysis/preview',
        expect.anything()
      );
    });

    it('is disabled outright when the account has no website', () => {
      renderWithProviders(<WebsiteScanDialog disabled websiteUrl="" />);
      expect(
        screen.getByRole('button', { name: /scan my website/i })
      ).toBeDisabled();
    });
  });

  describe('the preview is only ever requested once per scan', () => {
    it('does not re-diff when the finished job is refetched', async () => {
      const user = userEvent.setup();
      await scanToReview(user);

      const previewCalls = post.mock.calls.filter(
        (c) => c[0] === 'website-analysis/preview'
      );
      expect(previewCalls).toHaveLength(1);
      expect(previewCalls[0][1]).toEqual({ jobId: JOB_ID });
    });
  });
});
