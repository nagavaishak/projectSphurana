import { z } from 'zod';

export const graphicOutputFormatValues = ['png', 'jpg', 'webp'] as const;
export type GraphicOutputFormat = (typeof graphicOutputFormatValues)[number];

/** 20 MB cap per exported frame — keeps abuse vectors closed without blocking 4K PNGs. */
export const MAX_GRAPHIC_OUTPUT_CONTENT_LENGTH = 20 * 1024 * 1024;

export const createGraphicOutputUploadUrlSchema = z.object({
  id: z.string().min(1, 'Graphic ID is required'),
  organizationId: z.string().min(1, 'Organization ID is required'),
  slideId: z.string().min(1, 'Slide ID is required'),
  format: z.enum(graphicOutputFormatValues),
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  contentLength: z
    .number()
    .int()
    .positive()
    .max(
      MAX_GRAPHIC_OUTPUT_CONTENT_LENGTH,
      `Content length exceeds ${MAX_GRAPHIC_OUTPUT_CONTENT_LENGTH / (1024 * 1024)}MB limit`
    ),
});

export type CreateGraphicOutputUploadUrlInput = z.infer<
  typeof createGraphicOutputUploadUrlSchema
>;

export interface CreateGraphicOutputUploadUrlResult {
  uploadUrl: string;
  objectKey: string;
  bucket: string;
  expiresAt: string;
  contentType: string;
}
