/**
 * Always-loaded meta tools — `load_skill` (mid-conversation skill pivot),
 * `dispatchTour` (chat-driven tour invocation), and `remember` (write a
 * knowledge entry the model can recall in future conversations).
 *
 * The controller (W-C03-D) includes `metaTools` in every turn's tool set,
 * regardless of the conversation's `loadedSkillIds`. They never need to be
 * gated by the intent classifier or `load_skill` itself.
 *
 * @see docs/implementations/claire-briefs/window-c03-c.md
 * @see docs/implementations/claire-briefs/window-c13-remember-tool.md
 * @see docs/implementations/claire-briefs/track-c03.md §Step 7
 */

import { TOUR_TARGET_ROUTES, dispatchTourTool } from './dispatch-tour.tool.js';
import { loadSkillTool } from './load-skill.tool.js';
import { rememberTool } from './remember.tool.js';

export const metaTools = [
  loadSkillTool,
  dispatchTourTool,
  rememberTool,
] as const;

export { dispatchTourTool, loadSkillTool, rememberTool, TOUR_TARGET_ROUTES };
