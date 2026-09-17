/**
 * Packages tools — the sellables-catalogue capability.
 *
 * The one tool here spans three areas on purpose: a price list split by source
 * cannot be compared, and comparing is the point. See `coverage.ts` for which
 * of this area's endpoints Claire reaches, and
 * `packages/contracts/src/ports/catalog.port.ts` for why the three pricing
 * models stay in separate union members.
 */
import type { ToolDefinition } from '../../tool-factory/index.js';
import { listSellablesTool } from './list-sellables.tool.js';

export const packagesTools: ToolDefinition[] = [listSellablesTool];

export { listSellablesTool };
