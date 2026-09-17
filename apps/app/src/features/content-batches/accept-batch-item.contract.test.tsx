import { acceptBatchItemForm } from '@/features/content-batches/api/accept-batch-item';
import { expectedFromFields } from '@/lib/form-contract/fields';
import { runFormContract } from '@/test/form-contract/harness';
import {
  fireEvent,
  renderWithProviders,
  screen,
  waitFor,
  within,
} from '@/test/render';
import { format } from 'date-fns';
import { vi } from 'vitest';

/**
 * FORM CONTRACT: `POST content-batches/items/:id/accept` — accept a batch item.
 *
 * This operation DOES have a form: accepting also schedules the post, so the
 * {@link ReviewWorkspace} carries an editable caption, the target pages and the
 * post time, and all three ride along on the accept. The pages and the
 * date/time live behind the schedule popover, so the fills open it first.
 *
 * The onboarding `ContentApprovalSlide` is a REDUCED surface: it `owns: ['caption']`
 * and accepts with the caption only, because `scheduledAt` / `targetPageIds` must
 * stay planner-seeded. The builder encodes that by OMITTING those keys — omitted
 * ≠ `null`, which would mean "post it as a draft" — and its expected body pins
 * their absence, so the distinction cannot quietly rot.
 *
 * Property 4 then compares the ground both surfaces own (`caption`), and the
 * ownership check still holds `scheduledAt` / `targetPageIds` to being reachable
 * on the workspace.
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

const post = vi.fn();
const get = vi.fn();
vi.mock('@borradh-workspace/api-client', () => ({
  apiClient: {
    get: (...a: unknown[]) => get(...a),
    post: (...a: unknown[]) => post(...a),
    put: (...a: unknown[]) => vi.fn()(...a),
    delete: (...a: unknown[]) => vi.fn()(...a),
  },
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ContentPanelActions } from '@/features/assistant/_components/content-panel-actions';
import { ContentApprovalSlide } from '@/features/onboarding/slides/content-approval-slide';

const F = acceptBatchItemForm.fields;
const CAPTION = (F.caption as { sample: string }).sample;
const CAPTION_LABEL = acceptBatchItemForm.labels.caption;

/** The two connected pages the dialog toggles. The item seeds Beta only, so
 *  reaching the sample (`['page-a']`) means really clicking BOTH pills. */
const PAGES = [
  { id: 'page-a', platform: 'facebook', pageName: 'Alpha Page' },
  { id: 'page-b', platform: 'instagram', pageName: 'Beta Page' },
];

const ITEM = {
  id: 'item-1',
  kind: 'graphic',
  reviewStatus: 'pending',
  caption: 'Planner-seeded caption',
  targetPageIds: ['page-b'],
  scheduledAt: null,
  previousItemId: null,
  regenerationCount: 0,
  graphic: { id: 'g-1', status: 'ready', outputs: [] },
  video: null,
};

const PICK_TIME = '11:30';

/**
 * A day the calendar will accept — the scheduler only allows FUTURE dates, so a
 * hardcoded day-of-month flakes the moment the real date reaches it (this test
 * failed on the 15th of the month with a hardcoded `15`). Pick two days out and
 * keep it inside the calendar's current month; if that would overflow into next
 * month (which the picker isn't showing), fall back two days so the run — then
 * necessarily early in the month — still lands on a rendered future day.
 */
const pickedDay = (): Date => {
  const now = new Date();
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0
  ).getDate();
  const day =
    now.getDate() + 2 <= daysInMonth ? now.getDate() + 2 : daysInMonth - 2;
  return new Date(now.getFullYear(), now.getMonth(), day);
};

/** react-day-picker labels each day button "Wednesday, July 15th, 2026". */
const dayButtonName = (): string => format(pickedDay(), 'EEEE, MMMM do, yyyy');

/**
 * Same construction the dialog makes: local day at the picked time. The
 * canonical request contract COERCES `scheduledAt` (`z.coerce.date()`, matching
 * the server schema it derives), so the parsed body holds a `Date` — which
 * JSON-serialises to exactly the ISO string this used to assert.
 */
const expectedScheduledAt = (): Date => {
  const [h, m] = PICK_TIME.split(':').map(Number);
  const at = pickedDay();
  at.setHours(h, m, 0, 0);
  return at;
};

/**
 * Pages and the date/time live behind the schedule popover. Opening it is
 * idempotent — once it is mounted the trigger stays, so both fills can call
 * this without knowing which ran first.
 */
const openSchedulePopover = async (user: {
  click: (el: Element) => Promise<void>;
}) => {
  // "Is the popover open", not "is the date still unpicked". The old guard
  // looked for the "Pick a date" button, whose label becomes the chosen date
  // once one is picked — so after the `scheduledAt` fill it read as closed, and
  // the next fill clicked "Schedule" again while the popover was open. That
  // matches TWO buttons, since the confirm inside is also called Schedule.
  if (screen.queryByRole('dialog')) return;
  await user.click(screen.getByRole('button', { name: /^schedule$/i }));
  await screen.findByRole('button', { name: /pick a date/i });
};

runFormContract({
  operation: 'POST content-batches/items/:id/accept',
  description: 'Accept content batch item',
  form: acceptBatchItemForm,

  fills: {
    // Pill toggles, one per connected page. Seeded with Beta, so select Alpha
    // and deselect Beta to land on exactly `['page-a']`.
    targetPageIds: async (user) => {
      await openSchedulePopover(user);
      await user.click(screen.getByRole('button', { name: /Alpha Page/ }));
      await user.click(screen.getByRole('button', { name: /Beta Page/ }));
    },
    // A day picker plus a time input; the dialog folds the two into one ISO.
    scheduledAt: async (user) => {
      await openSchedulePopover(user);
      await user.click(screen.getByRole('button', { name: /pick a date/i }));
      const grid = await screen.findByRole('grid');
      await user.click(
        within(grid).getByRole('button', { name: dayButtonName() })
      );
      // jsdom has no segmented editing for `input[type=time]`, so typing into it
      // keystroke-by-keystroke lands on garbage. Fire the change the real control
      // fires — it is still located by its label, and still throws when it's gone.
      const time = screen.getByLabelText('Time to post');
      fireEvent.change(time, { target: { value: PICK_TIME } });
    },
  },

  surfaces: [
    {
      // `ContentPanelActions`, not `ReviewWorkspace`.
      //
      // The decision moved into the content panel, which the review page and
      // the assistant chat now share — so this component IS the surface that
      // owns where and when, on both. Mounting the workspace to reach it would
      // boot the whole assistant chat (transport, auth, streaming) to exercise
      // a date picker, and a contract test that drags in that much is a test
      // that fails for reasons unrelated to its contract.
      //
      // Caption is gone from here: rewriting copy is something Claire does in
      // conversation now. `content-approval-slide` below still owns it, so the
      // field stays reachable — which is exactly what PROPERTY 2 checks.
      name: 'content-panel-actions',
      owns: ['scheduledAt', 'targetPageIds'],
      run: async (ctx) => {
        renderWithProviders(<ContentPanelActions itemId={ITEM.id} />);
        await ctx.fillRest();
        // The commit lives INSIDE the schedule popover, with the date/time and
        // pages it commits. `fillRest` has already opened it.
        const popover = await screen.findByRole('dialog');
        await ctx.user.click(
          within(popover).getByRole('button', { name: /^schedule$/i })
        );
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
    {
      // The onboarding slide accepts with the CAPTION ONLY: schedule and pages
      // stay planner-seeded, which the builder encodes by OMITTING the keys —
      // `scheduledAt: null` would mean "post it as a draft" instead.
      name: 'content-approval-slide',
      owns: ['caption'],
      run: async (ctx) => {
        renderWithProviders(
          <ContentApprovalSlide
            session={{} as never}
            onAdvance={() => undefined}
          />
        );
        await screen.findByLabelText(CAPTION_LABEL);
        await ctx.fillRest();
        await ctx.user.click(screen.getByRole('button', { name: /^accept$/i }));
        await waitFor(() => expect(post).toHaveBeenCalled());
      },
    },
  ],

  reset: () => {
    post.mockReset();
    post.mockResolvedValue({ ...ITEM, reviewStatus: 'accepted' });
    get.mockReset();
    get.mockImplementation((path: string) => {
      if (path === 'content-batches/current') {
        return Promise.resolve({
          batch: { id: 'batch-1', periodMonth: '2026-07', status: 'ready' },
          items: [ITEM],
        });
      }
      if (path === 'integrations/meta-ads/pages') {
        return Promise.resolve({ pages: PAGES });
      }
      // The panel reads the item to seed the pages the planner already chose.
      // Without this the toggles start empty and "deselect Beta" adds it.
      if (path.startsWith(`content-batches/items/${ITEM.id}/state`)) {
        return Promise.resolve({
          targetPageIds: ITEM.targetPageIds,
          caption: ITEM.caption,
          assetId: 'g-1',
        });
      }
      return Promise.resolve({});
    });
  },

  readBody: () => {
    const call = post.mock.calls.find(
      (c) => c[0] === `content-batches/items/${ITEM.id}/accept`
    );
    if (!call) throw new Error('no accept call captured');
    return call[1] as Record<string, unknown>;
  },

  // The workspace: caption + targetPageIds ride through as typed, and the picked day
  // + time are folded into one ISO timestamp, so `scheduledAt` is spelled out.
  // The slide: caption only — `scheduledAt` / `targetPageIds` are ABSENT from the
  // body (not null), which is what keeps the planner-seeded values server-side.
  expectedBody: (surface) =>
    surface.owns
      ? // `scheduledAt` is `derived`, so its declared sample is `null` — the
        // value the user actually produces comes from the picker. A surface
        // that OWNS it still commits the picked time, so the override belongs
        // on both branches.
        expectedFromFields(
          F,
          // Only when this surface actually commits a time. An override is
          // applied regardless of `only`, so handing it to a caption-owning
          // surface would make it expect a field it never sends.
          surface.owns.includes('scheduledAt')
            ? { scheduledAt: expectedScheduledAt() }
            : {},
          { only: surface.owns }
        )
      : expectedFromFields(F, {
          caption: CAPTION,
          scheduledAt: expectedScheduledAt(),
        }),
});
