/**
 * CONTENT-BATCHES tools — none.
 *
 * There were two, `regenerateItem` and `updateItemCaption`, added when the
 * review page became the ordinary assistant chat. Both are now `patchContent`
 * (see `../content/`), which takes the owner's words and lets the server pick
 * the lever, rather than making Claire choose between a re-roll and a caption
 * rewrite from a context line carrying two ids.
 *
 * Neither ever ran, as it happens: both reached `content-batches/items/…` paths
 * that are not on the global whitelist, and neither declared
 * `additionalAllowedPaths`. `patchContent` declares them.
 *
 * The area keeps its file so the coverage manifest has a home. The decisions
 * about which batch endpoints Claire may reach are still recorded there, and
 * deleting them would read as "never considered" rather than "considered".
 */
import type { ToolDefinition } from '../../tool-factory/index.js';

export const contentBatchesTools: ToolDefinition[] = [];
