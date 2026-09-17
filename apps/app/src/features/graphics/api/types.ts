/**
 * Graphics API Types — re-exports from @borradh-workspace/api-client/types.
 *
 * Surface trimmed after the Canva → Fabric migration:
 *  - Slide CRUD (Add/Update/Reorder/Delete/Duplicate slide) is gone — the
 *    Fabric editor replaces per-slide mutations with whole-scene saves.
 *  - Stock-image search (PexelsPhoto, SearchStockImagesResponse) is gone.
 *  - Graphic-template tables (GraphicTemplate, GraphicTemplateCategory) are
 *    gone — templates live on `image_template` now.
 *  - Create/Render-Graphic inputs are gone — the live entry is
 *    `POST /graphics/generate` (AI generate-from-service flow).
 */
export type {
  Graphic,
  GraphicStatus,
  GraphicOutput,
  GraphicTemplateSummary,
  GraphicWithTemplate,
  ListGraphicTemplatesResponse,
  UpdateGraphicInput,
  ListGraphicsResponse,
  ListGraphicsParams,
} from '@borradh-workspace/api-client/types';

export {
  graphicStatusLabels,
  graphicStatusValues,
} from '@borradh-workspace/api-client/types';
