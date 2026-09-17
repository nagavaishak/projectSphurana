import { expectedFromFields } from '@/lib/form-contract/fields';
import type { Surface } from '@/test/form-contract/contract';
import { runFormContract } from '@/test/form-contract/harness';
import { renderWithProviders, screen, waitFor } from '@/test/render';
import type { OfferDiscountType } from '@borradh-workspace/api-client/types';
import { fixture, offerWithLinksSchema } from '@borradh-workspace/contracts';
import type { UserEvent } from '@testing-library/user-event';
import { format } from 'date-fns';
import { expect, vi } from 'vitest';

/**
 * FORM CONTRACT: `PUT /offers/:id` — update a promotion.
 *
 * ONE form, seven surfaces — because both of the things that vary here are
 * surfaces, not exemptions:
 *
 *   A BRANCH IS A SURFACE. Which numeric input the editor renders is
 *   discriminated by `discountType`, and the legacy shapes (`fixed_price`,
 *   `buy_x_get_y`) only offer their radio option while editing an offer that
 *   already uses them. So each shape is driven as its own surface, seeded with an
 *   offer of that shape. Every input is then owned by someone, and deleting any
 *   of them — including the legacy quantities — fails the contract.
 *
 *   A SPARSE WRITER IS A SURFACE. Claire's {@link OfferPreviewCard} patches only
 *   the slice Decision #14 allows in chat (name, validity, and the one numeric
 *   field matching the draft's shape), through its own controls with its own
 *   labels. It owns that slice; property 4 then holds the two writers to the same
 *   encoding of the ground they share — which is how it caught the card ISO-ing a
 *   picked day as UTC midnight while the editor used local midnight.
 *
 * Both writers pass typed intent to the ONE `buildUpdateOfferPayload`; they used
 * to hand-roll four separate builders straight into `apiClient.put`.
 */

// Radix (dialog, select, popover, radio, day-picker) needs these in jsdom.
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

const put = vi.fn();
const post = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => put(...a),
    delete: vi.fn(),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const navigate = vi.fn();
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => navigate,
  Navigate: () => null,
  // These specs stand up no RouterProvider (see `render-entity-editor.tsx`),
  // and the real `useRouterState` reads a router off context — so every editor
  // that resolves branch-scoped paths through `useRoutes()` crashes without
  // this. An org-level pathname is the honest answer: the editors are reached
  // from both branch and org routes.
  useRouterState: ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { pathname: '/dashboard' } }),
}));

import { OfferPreviewCard } from '@/features/claire/chat-preview';
import type { OfferPreviewCardState } from '@/features/claire/chat-preview';
import { renderEntityEditor } from '@/features/entity-editors/testing/render-entity-editor';
import type { OrganizationService } from '@/features/organization-services';
import { offerDraftLabels } from '../api/offer-draft-edit.form';
import { offerForm } from './offer-form-schema';

const OFFER_ID = 'o1';

/** The calendars open on the current month, so these are the days picked. */
const NOW = new Date();
const dayInThisMonth = (day: number) =>
  new Date(NOW.getFullYear(), NOW.getMonth(), day);
/** Both writers encode a picked day as its LOCAL midnight instant. */
const VALID_FROM = dayInThisMonth(15).toISOString();
const VALID_UNTIL = dayInThisMonth(20).toISOString();

/**
 * Opens a day-picker popover by its label and clicks a day. react-day-picker
 * names each day button "<Weekday>, July 15th, 2026" (and prefixes "Today, "),
 * so match on the tail — which also disambiguates the adjacent months' days.
 */
const escapeRegExp = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The control this label names — the same lookup the harness's drivers use. */
const byLabel = (label: string) =>
  screen.getByLabelText(new RegExp(`^\\s*${escapeRegExp(label)}\\s*$`, 'i'));

const pickDay = async (user: UserEvent, label: string, date: Date) => {
  await user.click(byLabel(label));
  const name = new RegExp(`${format(date, 'MMMM do, yyyy')}$`);
  await user.click(await screen.findByRole('button', { name }));
};

const retype = async (user: UserEvent, label: string, value: string) => {
  const input = byLabel(label);
  await user.clear(input);
  await user.type(input, value);
};

// ──────────────────────────────────────────────── the unified editor ────────

/**
 * Two services at DIFFERENT branches. The editor derives `locationIds` from
 * which services are picked, so a catalogue where every service is offered
 * everywhere would derive `[]` no matter what the surface did — and prove
 * nothing about the derivation.
 */
const SERVICES = [
  { id: 'svc-1', name: 'Haircut', locationIds: ['loc-2'] },
  { id: 'svc-2', name: 'Massage', locationIds: ['loc-1'] },
] as unknown as OrganizationService[];

const LOCATIONS = [
  { id: 'loc-1', name: 'Main Street' },
  { id: 'loc-2', name: 'Harbour Road' },
];

/**
 * A saved offer of the given shape. The editor only offers a LEGACY shape's
 * radio option when the offer it is editing already uses it — which is why each
 * shape is its own surface, seeded with its own offer.
 */
const savedOffer = (discountType: OfferDiscountType) =>
  fixture(offerWithLinksSchema, {
    id: OFFER_ID,
    organizationId: 'org_1',
    name: 'Old Promo',
    description: null,
    code: null,
    state: 'active',
    discountType,
    discountPercent: discountType === 'percentage' ? 10 : null,
    discountAmountCents: null,
    originalPriceCents: discountType === 'fixed_price' ? 10000 : null,
    offerPriceCents: discountType === 'fixed_price' ? 8000 : null,
    buyQuantity: discountType === 'buy_x_get_y' ? 3 : null,
    getQuantity: discountType === 'buy_x_get_y' ? 2 : null,
    limitPerClient: false,
    redemptionLimit: null,
    redemptionCount: 0,
    validFrom: null,
    validUntil: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    deletedAt: null,
    serviceIds: [],
    locationIds: [],
  });

/** The fields every discount shape renders. */
const EDITOR_COMMON = [
  'name',
  'description',
  'code',
  // NOT 'state': the editor has no state control, by design — see the field's
  // `exempt` note. A promotion is created active, and editing one carries the
  // saved state through untouched (`offerToForm`) so nothing here can silently
  // reactivate a paused promotion.
  'redemptionLimit',
  'validFrom',
  'validUntil',
  'serviceIds',
] as const;

type Ctx = Parameters<Surface<typeof offerForm.specs>['run']>[0];

/**
 * Mounts the UNIFIED EDITOR on the saved offer, the way `/edit/promotion/:id`
 * does. The editor resolves its record from the offers list the catalog already
 * caches, so the list read is what seeds the shape under test.
 */
const openEditor = async (discountType: OfferDiscountType) => {
  get.mockImplementation((path: string) => {
    if (typeof path !== 'string') return Promise.resolve({ items: [] });
    if (path.startsWith('offers')) {
      return Promise.resolve({ items: [savedOffer(discountType)], total: 1 });
    }
    if (path.startsWith('organization-locations')) {
      return Promise.resolve({ items: LOCATIONS });
    }
    if (path.startsWith('organization-services')) {
      return Promise.resolve({ items: SERVICES, total: SERVICES.length });
    }
    return Promise.resolve({ items: [] });
  });

  renderEntityEditor('promotion', { id: OFFER_ID });
  // The editor hydrates the form once the record arrives — wait for it, or the
  // reset overwrites what we filled.
  await screen.findByDisplayValue('Old Promo');
};

/** Drives the fields every branch shares, then submits. */
const fillCommonAndSave = async (ctx: Ctx) => {
  await ctx.fill('name', 'description', 'code', 'redemptionLimit');
  await ctx.fill('validFrom', 'validUntil');
  // Services live in their OWN section, so reaching the picker means switching
  // to it first — the same click the operator makes.
  // The desktop nav and the mobile pills both render; either button works, so
  // pick one deterministically.
  await ctx.user.click(
    screen.getAllByRole('button', { name: /^Services$/ })[0]
  );
  await ctx.fill('serviceIds');

  await ctx.user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(put).toHaveBeenCalled());
};

/** The keys the editor sends whatever shape it is in. */
const DIALOG_ALWAYS = {
  limitPerClient: false,
  validFrom: VALID_FROM,
  validUntil: VALID_UNTIL,
  // Derived, not answered: picking `svc-1` — offered only at Harbour Road —
  // scopes the promotion to that branch. This is the assertion that the
  // service picker actually writes the branches its selection implies.
  locationIds: ['loc-2'],
};

/** The builder NULLS every discount shape's keys but the selected one's. */
const nulledExcept = (keep: Record<string, unknown>) => ({
  discountPercent: null,
  discountAmountCents: null,
  originalPriceCents: null,
  offerPriceCents: null,
  buyQuantity: null,
  getQuantity: null,
  ...keep,
});

// ───────────────────────────────────────── Claire's offer preview card ───────

const baseDraft: OfferPreviewCardState = {
  draftId: OFFER_ID,
  name: 'Old Promo',
  code: null,
  state: 'draft',
  validFrom: null,
  validUntil: null,
  discountType: 'fixed_price',
  discountPercent: null,
  originalPriceCents: 10000,
  offerPriceCents: 8000,
  buyQuantity: null,
  getQuantity: null,
  limitPerClient: false,
  redemptionLimit: null,
  serviceIds: [],
  locationIds: [],
};

/**
 * The card reaches the shared fields through its OWN controls — same fields,
 * chat-card vocabulary. Single-sourced from `offerDraftLabels`, which the card
 * renders, so these still throw when a control is deleted. The typed values are
 * the form's samples, which is what lets property 4 compare the two writers.
 */
const CARD_FILLS = {
  name: async (user: UserEvent) =>
    retype(user, offerDraftLabels.name, 'Summer Special'),
  offerPriceEuros: async (user: UserEvent) =>
    retype(user, offerDraftLabels.offerPriceEuros, '75'),
  discountPercent: async (user: UserEvent) =>
    retype(user, offerDraftLabels.discountPercent, '20'),
  validUntil: async (user: UserEvent) =>
    pickDay(user, offerDraftLabels.validUntil, dayInThisMonth(20)),
};

/** The footer write is the only one carrying `name` AND the numeric edit; the
 *  onBlur writes are single-key, so wait until the LAST put is the footer's. */
const awaitFooterWrite = () =>
  waitFor(() => expect(put.mock.calls.at(-1)?.[1]).toHaveProperty('name'));

const CARD_FIXED_PRICE = 'Claire preview card (fixed price) — save draft';
const CARD_FIXED_PRICE_PUBLISH = 'Claire preview card (fixed price) — publish';
const CARD_PERCENTAGE = 'Claire preview card (percentage) — save draft';

// ─────────────────────────────────────────────────────────── the contract ────

runFormContract({
  operation: 'PUT offers/:id',
  description: 'Update offer',
  form: offerForm,

  fills: {
    validFrom: async (user) => pickDay(user, 'Start Date', dayInThisMonth(15)),
    validUntil: async (user) => pickDay(user, 'End Date', dayInThisMonth(20)),
    serviceIds: async (user) => {
      await user.click(await screen.findByLabelText('Haircut'));
    },
  },

  surfaces: [
    {
      name: 'unified editor (percentage)',
      owns: [...EDITOR_COMMON, 'discountType', 'discountPercent'],
      run: async (ctx) => {
        await openEditor('fixed_price');
        // The radio driver picks `percentage`, which clears the other shapes.
        await ctx.fill('discountType', 'discountPercent');
        await fillCommonAndSave(ctx);
      },
    },
    {
      name: 'unified editor (fixed amount)',
      owns: [...EDITOR_COMMON, 'discountAmountEuros'],
      run: async (ctx) => {
        await openEditor('fixed_price');
        await ctx.user.click(
          screen.getByRole('radio', { name: /Fixed Amount Discount/i })
        );
        await ctx.fill('discountAmountEuros');
        await fillCommonAndSave(ctx);
      },
    },
    {
      name: 'unified editor (fixed price — legacy)',
      owns: [...EDITOR_COMMON, 'originalPriceEuros', 'offerPriceEuros'],
      run: async (ctx) => {
        await openEditor('fixed_price');
        await ctx.fill('originalPriceEuros', 'offerPriceEuros');
        await fillCommonAndSave(ctx);
      },
    },
    {
      name: 'unified editor (buy X get Y — legacy)',
      owns: [...EDITOR_COMMON, 'buyQuantity', 'getQuantity'],
      run: async (ctx) => {
        await openEditor('buy_x_get_y');
        await ctx.fill('buyQuantity', 'getQuantity');
        await fillCommonAndSave(ctx);
      },
    },
    {
      name: CARD_FIXED_PRICE,
      owns: ['name', 'offerPriceEuros', 'validUntil'],
      fills: CARD_FILLS,
      run: async (ctx) => {
        renderWithProviders(<OfferPreviewCard draft={baseDraft} />);
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /save draft/i })
        );
        await awaitFooterWrite();
      },
    },
    {
      name: CARD_FIXED_PRICE_PUBLISH,
      owns: ['name', 'offerPriceEuros', 'validUntil'],
      fills: CARD_FILLS,
      run: async (ctx) => {
        renderWithProviders(<OfferPreviewCard draft={baseDraft} />);
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /^publish$/i })
        );
        await waitFor(() =>
          expect(
            post.mock.calls.some(
              (c) => c[0] === `offers/${OFFER_ID}/promote-draft`
            )
          ).toBe(true)
        );
      },
    },
    {
      name: CARD_PERCENTAGE,
      owns: ['name', 'discountPercent', 'validUntil'],
      fills: CARD_FILLS,
      run: async (ctx) => {
        renderWithProviders(
          <OfferPreviewCard
            draft={{
              ...baseDraft,
              discountType: 'percentage',
              discountPercent: 10,
              originalPriceCents: null,
              offerPriceCents: null,
            }}
          />
        );
        await ctx.fillRest();
        await ctx.user.click(
          screen.getByRole('button', { name: /save draft/i })
        );
        await awaitFooterWrite();
      },
    },
  ],

  reset: () => {
    put.mockReset();
    put.mockResolvedValue({ id: OFFER_ID });
    post.mockReset();
    post.mockResolvedValue({ id: OFFER_ID });
    get.mockReset();
    get.mockResolvedValue({ items: [] });
  },

  // The editor PUTs once. The card also PUTs each field onBlur (single-key
  // bodies) before its footer button sends the whole edit — that final write is
  // the one under test, so take the last.
  readBody: () => {
    const calls = put.mock.calls.filter((c) => c[0] === `offers/${OFFER_ID}`);
    const call = calls.at(-1);
    if (!call) throw new Error(`no PUT offers/${OFFER_ID} call captured`);
    return call[1] as Record<string, unknown>;
  },

  // The editor always sends the FULL body — the builder owns euro→cents,
  // Date→ISO and the nulling of every shape but the selected one. The card sends
  // only the slice it owns.
  expectedBody: (surface) => {
    const only = surface.owns;
    const base = (extra: Record<string, unknown>) =>
      expectedFromFields(offerForm.fields, extra, { only });

    switch (surface.name) {
      case 'unified editor (percentage)':
        // The one shape whose value survives: 20% (the field's own sample).
        return base({
          ...DIALOG_ALWAYS,
          ...nulledExcept({ discountPercent: 20 }),
        });
      case 'unified editor (fixed amount)':
        return base({
          ...DIALOG_ALWAYS,
          discountType: 'fixed_amount',
          ...nulledExcept({ discountAmountCents: 1000 }),
        });
      case 'unified editor (fixed price — legacy)':
        return base({
          ...DIALOG_ALWAYS,
          discountType: 'fixed_price',
          ...nulledExcept({ originalPriceCents: 10000, offerPriceCents: 7500 }),
        });
      case 'unified editor (buy X get Y — legacy)':
        return base({
          ...DIALOG_ALWAYS,
          discountType: 'buy_x_get_y',
          // buy/get reach the wire unchanged, so they come from the samples.
          ...nulledExcept({}),
          buyQuantity: 2,
          getQuantity: 1,
        });
      case CARD_PERCENTAGE:
        return base({ validUntil: VALID_UNTIL });
      default:
        // Both fixed-price card surfaces: €75 typed → 7500 minor units.
        return base({ offerPriceCents: 7500, validUntil: VALID_UNTIL });
    }
  },
});
