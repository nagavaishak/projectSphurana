import { z } from 'zod';
import { graphicOutputFormatValues } from '../create-graphic-output-upload-url/create-graphic-output-upload-url.schema.js';

export const confirmGraphicOutputSchema = z.object({
  id: z.string().min(1, 'Graphic ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  objectKey: z.string().min(1, 'Object key is required'),
  slideId: z.string().min(1, 'Slide ID is required'),
  slideOrder: z.number().int().min(0),
  format: z.enum(graphicOutputFormatValues),
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
});

export type ConfirmGraphicOutputInput = z.infer<
  typeof confirmGraphicOutputSchema
>;
