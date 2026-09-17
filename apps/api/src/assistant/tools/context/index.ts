/**
 * Factory-shaped context tools.
 *
 * Ported from the legacy `context-tools.ts` (334L) per W-C02-E. The legacy
 * file remains in place until W-C03-D removes it; the controller wires the
 * factory-shaped variants exclusively.
 *
 * Tool names produced by the factory: `context_<action>` (e.g.
 * `context_listServices`). Skill registries (W-C03-A) reference the
 * pre-factory names; W-C03-D's controller wiring is responsible for the
 * skill-name → factory-tool mapping.
 */

import type { ToolDefinition } from '../../tool-factory/index.js';
import { addServiceLocationsTool } from './add-service-locations.tool.js';
import { checkConnectedPagesTool } from './check-connected-pages.tool.js';
import { createServiceTool } from './create-service.tool.js';
import { deleteServiceTool } from './delete-service.tool.js';
import { getOrganizationContextTool } from './get-organization-context.tool.js';
import { getServiceDetailsTool } from './get-service-details.tool.js';
import { listOffersTool } from './list-offers.tool.js';
import { listRecentGraphicsTool } from './list-recent-graphics.tool.js';
import { listRecentVideosTool } from './list-recent-videos.tool.js';
import { listServicesTool } from './list-services.tool.js';
import { updateServiceTool } from './update-service.tool.js';

export const contextTools: ToolDefinition[] = [
  getOrganizationContextTool,
  listServicesTool,
  getServiceDetailsTool,
  createServiceTool,
  updateServiceTool,
  addServiceLocationsTool,
  deleteServiceTool,
  listRecentVideosTool,
  listRecentGraphicsTool,
  listOffersTool,
  checkConnectedPagesTool,
];

export {
  addServiceLocationsTool,
  checkConnectedPagesTool,
  createServiceTool,
  deleteServiceTool,
  getOrganizationContextTool,
  getServiceDetailsTool,
  listOffersTool,
  listRecentGraphicsTool,
  listRecentVideosTool,
  listServicesTool,
  updateServiceTool,
};
