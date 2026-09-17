import type { DocumentMediaDeps } from '../models/index.js';
import { prepareImage } from './image-prep.js';
import {
  extractPdfText,
  renderPdfPages,
  warmupDocumentRasterizer,
} from './pdf-rasterizer.js';

/** The real media pipeline — the worker's composition root wires this in. */
export const createDocumentMediaDeps = (): DocumentMediaDeps => ({
  extractPdfText,
  renderPdfPages,
  prepareImage,
});

export { warmupDocumentRasterizer };
