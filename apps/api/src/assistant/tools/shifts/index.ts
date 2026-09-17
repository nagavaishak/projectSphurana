/**
 * Shifts tools — the availability capability.
 *
 * See `coverage.ts` for which of this area's endpoints Claire reaches, and
 * `packages/contracts/src/ports/availability.port.ts` for why the diagnosis is
 * a port rather than four separate read tools.
 */
import type { ToolDefinition } from '../../tool-factory/index.js';
import { explainAvailabilityTool } from './explain-availability.tool.js';

export const shiftsTools: ToolDefinition[] = [explainAvailabilityTool];

export { explainAvailabilityTool };
