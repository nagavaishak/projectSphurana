/**
 * @borradh-workspace/api-client - Graphics API Types
 *
 * Types for the graphics API endpoints. Derived from the features package.
 *
 * The Canva-era endpoints (create-graphic, render-graphic, search-stock-images,
 * legacy slide CRUD) and the Fabric scene editor (GET/PATCH /graphics/:id/scene)
 * have been removed. The live surface is:
 *   - POST /graphics/generate         — AI generate-from-service flow
 *   - GET  /graphics                  — list
 *   - GET  /graphics/:id              — read
 *   - PATCH /graphics/:id             — update mutable metadata
 *   - DELETE /graphics/:id            — delete
 */

import {
  graphicCategoryLabels,
  graphicCategoryValues,
  graphicStatusLabels,
  graphicStatusValues,
} from '@borradh-workspace/features/shared';

import type {
  Graphic as BackendGraphic,
  GraphicOutput,
} from '@borradh-workspace/features/shared';

import type {
  GraphicTemplateSummary as BackendGraphicTemplateSummary,
  GraphicWithTemplate as BackendGraphicWithTemplate,
  ListGraphicTemplatesOutput as BackendListGraphicTemplatesOutput,
  ListGraphicsInput as BackendListGraphicsInput,
  UpdateGraphicInput as BackendUpdateGraphicInput,
} from '@borradh-workspace/features/graphics';

import type { Serialize } from './serialization.js';

// ============================================================================
// ENUM TYPES — derived from labels (source of truth)
// ============================================================================

export type GraphicStatus = keyof typeof graphicStatusLabels;

/**
 * Editorial category for AI graphic generation (tips / motivation / question /
 * storyline). Relocated here from the removed image-templates type module —
 * it is part of the generation surface (POST /graphics/generate), not the
 * deleted Fabric template-authoring surface.
 */
export type GraphicCategory = keyof typeof graphicCategoryLabels;

export {
  graphicStatusLabels,
  graphicStatusValues,
  graphicCategoryLabels,
  graphicCategoryValues,
};

// ============================================================================
// ENTITY TYPES — serialised for the wire (Date → string)
// ============================================================================

export type Graphic = Serialize<BackendGraphic>;
export type GraphicWithTemplate = Serialize<BackendGraphicWithTemplate>;

export type { GraphicOutput };

// ============================================================================
// RESPONSE TYPES
// ============================================================================

export interface ListGraphicsResponse {
  items: Graphic[];
  limit: number;
  offset: number;
}

/**
 * Curated style summary from `GET /graphics/templates` — drives the
 * generate-graphic dialog's style picker. No Dates, so no Serialize needed.
 */
export type GraphicTemplateSummary = BackendGraphicTemplateSummary;
export type ListGraphicTemplatesResponse = BackendListGraphicTemplatesOutput;

// ============================================================================
// INPUT TYPES — derived from backend, omitting fields the controller injects
// ============================================================================

export type UpdateGraphicInput = Omit<
  BackendUpdateGraphicInput,
  'id' | 'organizationId'
>;

export type ListGraphicsParams = Omit<
  BackendListGraphicsInput,
  'organizationId'
>;
