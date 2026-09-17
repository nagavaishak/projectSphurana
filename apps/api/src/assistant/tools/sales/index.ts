/**
 * Sales tools — the takings capability.
 *
 * READS ONLY. See `coverage.ts` for which of this area's endpoints Claire
 * reaches and why every write in the checkout state machine stays out of her
 * hands, and `packages/contracts/src/ports/sales.port.ts` for why a takings
 * figure assembled from N day-reads and two money channels is a port rather
 * than a pair of list tools.
 */
import type { ToolDefinition } from '../../tool-factory/index.js';
import { getTakingsTool } from './get-takings.tool.js';

export const salesTools: ToolDefinition[] = [getTakingsTool];

export { getTakingsTool };
