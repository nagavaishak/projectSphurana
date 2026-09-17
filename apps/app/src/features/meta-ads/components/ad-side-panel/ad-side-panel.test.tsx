import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Ad } from '../../api/types';

/**
 * The ad editor's THREE rules, none of which a payload test can hold, because
 * each is a decision the component makes about the ad in front of it.
 *
 *  1. Saving a live ad's copy replaces its creative on Meta and sends the ad
 *     back through review. The owner agrees to that BEFORE the write, not via
 *     a notice they scrolled past.
 *  2. The creative can only be swapped where the server allows it — an
 *     unpublished Borradh draft — so the pencil opens the picker there and
 *     explains itself everywhere else, rather than firing a request that 422s.
 *  3. A rename is not a re-review. `updateAdImpl` rebuilds the creative when a
 *     copy field is PRESENT on the wire, so only the changed fields travel and
 *     the confirm fires only for a real copy edit.
 *
 * These were verified in a browser once. That is not a regression net: the
 * next person to touch this file gets no signal at all. Hence this suite.
 */

const updateAsync = vi.fn();
const replaceCreativeAsync = vi.fn();
const duplicateAsync = vi.fn();
const closePanel = vi.fn();
const toastWarning = vi.fn();

vi.mock('@/components/app/side-panel', () => ({
  useSidePanel: () => ({ close: closePanel, isOpen: true }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

vi.mock('../../api', async () => {
  const actual = await vi.importActual<
    typeof import('../../api/update-ad/update-ad.payload')
  >('../../api/update-ad/update-ad.payload');
  return {
    // The real builder — the payload is the thing under test in the rename case.
    buildUpdateAdPayload: actual.buildUpdateAdPayload,
    useUpdateAd: () => ({ executeAsync: updateAsync, isExecuting: false }),
    useReplaceAdCreative: () => ({
      executeAsync: replaceCreativeAsync,
      isExecuting: false,
    }),
    useDuplicateAd: () => ({
      executeAsync: duplicateAsync,
      isExecuting: false,
    }),
  };
});

// The picker's own media queries are not what these tests are about; an empty
// library still opens the dialog, which is the assertion that matters.
vi.mock('@/features/assets', () => ({
  useListAssets: () => ({ assets: [], isLoading: false }),
}));
vi.mock('@/features/graphics', () => ({
  useListGraphics: () => ({ graphics: [], isLoading: false }),
}));
vi.mock('@/features/videos', () => ({
  useListVideos: () => ({ videos: [], isLoading: false }),
}));

import { AdSidePanel } from './ad-side-panel';

const baseAd = {
  id: 'ad-1',
  name: 'Autumn Haircut Promo',
  headline: 'Autumn cuts, booking now',
  primaryText: 'Chairs free this week.',
  description: null,
  callToAction: 'BOOK_NOW',
  destinationUrl: null,
  status: 'draft',
  metaAdId: null,
  isImported: false,
  useExistingPost: false,
  leadFormId: null,
  destinations: null,
  videoId: null,
  graphicId: null,
  metaThumbnailUrl: null,
  graphicImageUrl: null,
  graphicImageWidth: null,
  graphicImageHeight: null,
  adPlacement: 'facebook',
} as unknown as Ad;

/** A published ad: on Meta, therefore live. */
const liveAd = {
  ...baseAd,
  id: 'ad-live',
  status: 'active',
  metaAdId: '120246528563240037',
} as unknown as Ad;

function save() {
  return screen.getByRole('button', { name: /save changes/i });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.clearAllMocks());

describe('AdSidePanel — confirming a re-review', () => {
  it('asks before replacing a live ad’s creative, and writes nothing until agreed', async () => {
    const user = userEvent.setup();
    render(<AdSidePanel ad={liveAd} />);

    await user.clear(screen.getByLabelText(/headline/i));
    await user.type(screen.getByLabelText(/headline/i), 'Two chairs left');
    await user.click(save());

    // The dialog is up and NOTHING has been sent.
    expect(
      await screen.findByText(/send it back for review/i)
    ).toBeInTheDocument();
    expect(updateAsync).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /keep it running/i }));
    expect(updateAsync).not.toHaveBeenCalled();
  });

  it('writes once the owner agrees', async () => {
    const user = userEvent.setup();
    render(<AdSidePanel ad={liveAd} />);

    await user.clear(screen.getByLabelText(/headline/i));
    await user.type(screen.getByLabelText(/headline/i), 'Two chairs left');
    await user.click(save());
    await user.click(
      await screen.findByRole('button', {
        name: /replace and send for review/i,
      })
    );

    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
    expect(updateAsync.mock.calls[0][0].data.headline).toBe('Two chairs left');
  });

  it('does NOT ask for a rename, and sends only the name', async () => {
    // The regression this whole payload change exists for: a rename used to
    // rebuild the creative and pause delivery, with no warning shown.
    const user = userEvent.setup();
    render(<AdSidePanel ad={liveAd} />);

    await user.clear(screen.getByLabelText(/ad name/i));
    await user.type(screen.getByLabelText(/ad name/i), 'Autumn Promo (Sept)');
    await user.click(save());

    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/send it back for review/i)).toBeNull();

    const { data } = updateAsync.mock.calls[0][0];
    expect(data.name).toBe('Autumn Promo (Sept)');
    // Any of these on the wire makes the server rebuild the creative.
    expect(data).not.toHaveProperty('headline');
    expect(data).not.toHaveProperty('primaryText');
    expect(data).not.toHaveProperty('description');
  });

  it('does not ask on a draft — there is no delivery to interrupt', async () => {
    const user = userEvent.setup();
    render(<AdSidePanel ad={baseAd} />);

    await user.clear(screen.getByLabelText(/headline/i));
    await user.type(screen.getByLabelText(/headline/i), 'Draft headline');
    await user.click(save());

    await waitFor(() => expect(updateAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/send it back for review/i)).toBeNull();
  });
});

describe('AdSidePanel — where the creative may be swapped', () => {
  it('opens the picker on an unpublished draft', async () => {
    const user = userEvent.setup();
    render(<AdSidePanel ad={baseAd} />);

    await user.click(screen.getByRole('button', { name: /change creative/i }));

    expect(
      await screen.findByText(/choose a new creative/i)
    ).toBeInTheDocument();
  });

  it('explains instead of offering it on a published ad', async () => {
    const user = userEvent.setup();
    render(<AdSidePanel ad={liveAd} />);

    await user.click(screen.getByRole('button', { name: /change creative/i }));

    expect(
      await screen.findByText(/can't be swapped here/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/fixed once an ad is on Meta/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/choose a new creative/i)).toBeNull();
  });

  it('explains on an ad whose publish FAILED, which has no metaAdId', async () => {
    // `status !== 'draft'` and "not on Meta" are different questions; the
    // server refuses this ad, so the panel must not offer the picker for it.
    const user = userEvent.setup();
    const failed = { ...baseAd, status: 'error' } as unknown as Ad;
    render(<AdSidePanel ad={failed} />);

    await user.click(screen.getByRole('button', { name: /change creative/i }));

    expect(
      await screen.findByText(/no longer an editable draft/i)
    ).toBeInTheDocument();
    expect(screen.queryByText(/choose a new creative/i)).toBeNull();
  });

  it('offers a duplicate as the route that does work', async () => {
    const user = userEvent.setup();
    render(<AdSidePanel ad={liveAd} />);

    await user.click(screen.getByRole('button', { name: /change creative/i }));
    await user.click(
      await screen.findByRole('button', { name: /duplicate this ad/i })
    );

    await waitFor(() => expect(duplicateAsync).toHaveBeenCalledWith('ad-live'));
  });

  it('hides the pencil entirely on an imported ad', () => {
    const imported = { ...baseAd, isImported: true } as unknown as Ad;
    render(<AdSidePanel ad={imported} />);

    expect(
      screen.queryByRole('button', { name: /change creative/i })
    ).toBeNull();
  });
});

describe('AdSidePanel — a save that half-lands', () => {
  it('says which half landed and keeps the panel open to retry', async () => {
    const user = userEvent.setup();
    replaceCreativeAsync.mockResolvedValueOnce({});
    updateAsync.mockRejectedValueOnce(new Error('500'));

    render(<AdSidePanel ad={baseAd} />);

    // Stage a creative AND edit the copy, then fail the copy half.
    await user.click(screen.getByRole('button', { name: /change creative/i }));
    await screen.findByText(/choose a new creative/i);
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    await user.clear(screen.getByLabelText(/headline/i));
    await user.type(screen.getByLabelText(/headline/i), 'New copy');
    await user.click(save());

    await waitFor(() => expect(updateAsync).toHaveBeenCalled());
    // The panel must NOT close on a failure — the typed copy would be lost.
    expect(closePanel).not.toHaveBeenCalled();
  });
});

describe('AdSidePanel — state cannot leak between ads', () => {
  it('shows the new ad’s copy when the panel is re-rendered for another ad', () => {
    // The host renders `{content}` unkeyed, so `<AdSidePanel>` updates in place
    // rather than remounting when a second ad is opened; `useForm` defaults
    // only apply on mount. The call sites key by `ad.id` to force the remount,
    // and this is that contract: same key → same instance, new key → fresh.
    const { rerender } = render(<AdSidePanel key={baseAd.id} ad={baseAd} />);
    expect(screen.getByLabelText(/ad name/i)).toHaveValue(
      'Autumn Haircut Promo'
    );

    const other = {
      ...baseAd,
      id: 'ad-2',
      name: 'Balayage Winter Launch',
    } as unknown as Ad;
    rerender(<AdSidePanel key={other.id} ad={other} />);

    expect(screen.getByLabelText(/ad name/i)).toHaveValue(
      'Balayage Winter Launch'
    );
  });
});
