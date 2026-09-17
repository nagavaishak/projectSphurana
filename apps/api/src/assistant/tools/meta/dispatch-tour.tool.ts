import { z } from 'zod';
import { defineTool } from '../../tool-factory/index.js';

/**
 * `dispatchTour` — invoke an interactive tour over the live UI from chat.
 *
 * Always loaded. The model uses this when the user asks to be *shown* how to
 * find or use a feature step-by-step. Tours are teach-the-UI flows for
 * onboarding and discovery — they never create entities.
 *
 * **Backend → Frontend dispatch contract**: the tool does *not* run the tour
 * from the backend. It returns a presentation payload of shape
 * `{ type: 'tour_dispatch', tourKind, payload, navigateTo }`. The frontend
 * tour runner consumes the payload, navigates first (so the tour's first
 * step targets exist), then dispatches via the existing
 * `ClaireWalkthroughProvider`.
 *
 * **No `create_*` kinds** — the legacy `create_ad` / `create_video` /
 * `create_offer` / `create_post` tours were retired when Claire became the
 * only creation entry point. Use the per-feature creation tools (e.g.
 * `launchAd`, `generateVideo`, `createOffer`, `schedulePost`) instead.
 */

/**
 * Registered tour kinds. Empty for now — the route map below should be the
 * source of truth as onboarding / discovery tours land.
 *
 * Source of truth: each tour's first step's `navigateBefore` in
 * `apps/app/src/features/claire/walkthroughs/<tour>.tour.ts`.
 */
const TOUR_TARGET_ROUTES: Readonly<Record<string, string>> = {};

const KNOWN_TOUR_KINDS = Object.keys(TOUR_TARGET_ROUTES);

export const dispatchTourTool = defineTool<
  { tourKind: string; payload?: Record<string, unknown> },
  string
>({
  feature: 'meta',
  action: 'dispatchTour',
  description:
    'Run an interactive onboarding or discovery tour over the live UI when the user asks to be shown where a feature lives or how to find it. Do not use this to create videos, campaigns, ads, posts, offers, or any other entity — call the dedicated creation tools directly instead.',
  inputSchema: z.object({
    tourKind: z
      .string()
      .describe(
        KNOWN_TOUR_KINDS.length > 0
          ? `Which tour to run. Available: ${KNOWN_TOUR_KINDS.join(', ')}.`
          : 'Which tour to run. No tours are currently registered — this tool will return an error until onboarding/discovery tours are added.'
      ),
    payload: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Optional placeholder values interpolated into the tour copy. See each tour file for expected keys.'
      ),
  }),
  destructive: false,
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Starting the tour' },
  execute: async ({ tourKind, payload }) => {
    const navigateTo = TOUR_TARGET_ROUTES[tourKind];
    if (!navigateTo) {
      return {
        data: `No interactive tours are registered yet (requested "${tourKind}"). Walk the user through it conversationally instead — describe where to click and what they will see.`,
      };
    }
    return {
      presentation: {
        type: 'tour_dispatch',
        tourKind,
        payload: payload ?? {},
        navigateTo,
      },
    };
  },
});

export { TOUR_TARGET_ROUTES };
