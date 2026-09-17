/**
 * Practitioners tools — the team roster capability.
 *
 * See `coverage.ts` for which of this area's endpoints Claire reaches, and
 * `packages/contracts/src/ports/practitioners.port.ts` for why the roster and
 * the who-does-this-service lookup share one result union.
 */
import type { ToolDefinition } from '../../tool-factory/index.js';
import { listPractitionersTool } from './list-practitioners.tool.js';

export const practitionersTools: ToolDefinition[] = [listPractitionersTool];

export { listPractitionersTool };
