import type { SurfaceContext } from '@/test/form-contract/contract';
import { screen, waitFor, within } from '@/test/render';
import type { UserEvent } from '@testing-library/user-event';
import { expect } from 'vitest';

import type { adWizardForm } from '../-schema';

/**
 * The shared walk through the ad wizard, used by BOTH ad contracts — `POST
 * meta-ads` (save as draft) and `POST meta-ads/launch` (publish). They drive the
 * identical four steps over the identical form and differ only in the button
 * they press at the end, so the walk lives here rather than being copied.
 *
 * It is deliberately NOT a test file: the module mocks that make the wizard
 * mountable are declared in each spec (vi.mock only hoists within its own file),
 * and this module is imported into that already-mocked graph.
 */

type Fields = (typeof adWizardForm)['specs'];
type Ctx = SurfaceContext<Fields>;

/** Which surface is mounted — several controls differ between the two. */
let surface: 'desktop' | 'mobile' = 'desktop';

export const setAdSurface = (next: 'desktop' | 'mobile') => {
  surface = next;
};

export const CAMPAIGN_NAME = 'Summer Campaign';
export const SERVICE_NAME = 'Balayage';
export const PAGE_NAME = 'My Salon';
export const VIDEO_THUMBNAIL = 'https://x/vid_1.png';

/** How the harness drives the wizard's bespoke controls. */
export const adWizardFills: Partial<
  Record<keyof Fields, (user: UserEvent) => Promise<void>>
> = {
  /** A Radix Select on desktop; a list of campaign cards on mobile. */
  campaignId: async (user) => {
    if (surface === 'mobile') {
      await user.click(await screen.findByText(CAMPAIGN_NAME));
      return;
    }
    await user.click(await screen.findByRole('combobox', { name: 'Campaign' }));
    await user.click(
      await screen.findByRole('option', { name: new RegExp(CAMPAIGN_NAME) })
    );
  },

  /** Searchable single-select combobox (shared DetailsStep). */
  serviceIds: async (user) => {
    await user.click(
      await screen.findByRole('option', { name: new RegExp(SERVICE_NAME) })
    );
  },

  /**
   * A list of Page cards. The lone Page auto-selects, but the card must still be
   * on screen and clickable — that is what property 2 is checking.
   */
  metaAdsPageId: async (user) => {
    await user.click(
      await screen.findByRole('button', { name: new RegExp(PAGE_NAME) })
    );
  },

  /** The media grid: a labelled card on desktop, a thumbnail button on mobile. */
  videoId: async (user) => {
    if (surface === 'mobile') {
      const thumb = await waitFor(() => {
        const el = document
          .querySelector(`img[src="${VIDEO_THUMBNAIL}"]`)
          ?.closest('button');
        if (!el) throw new Error('mobile video thumbnail not rendered yet');
        return el;
      });
      await user.click(thumb);
      return;
    }
    await user.click(await screen.findByTestId('video-card'));
  },
};

/** Advance past the step the wizard is currently on. */
const advance = async (user: UserEvent) => {
  const next = await screen.findByRole('button', { name: 'Continue' });
  await waitFor(() => expect(next).not.toBeDisabled());
  await user.click(next);
};

/**
 * Walk campaign → details → media → customize, filling every declared field at
 * the step where its control appears. Leaves the wizard on the customize step,
 * with only the terminal action (draft / publish) left for the caller.
 */
export const driveAdWizardToCustomize = async (ctx: Ctx) => {
  await ctx.fill('campaignId');
  await advance(ctx.user);

  await screen.findByText('Ad details');
  await ctx.fill('adName', 'serviceIds', 'metaAdsPageId');
  await advance(ctx.user);

  await ctx.fill('videoId');
  await advance(ctx.user);

  await screen.findByText('Customize your ad');
  await ctx.fill(
    'headline',
    'primaryText',
    'description',
    'callToAction',
    'destinationUrl'
  );
};

/** Confirm the publish modal (launch only). */
export const confirmPublish = async (user: UserEvent) => {
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'Publish' }));
};
