import { z } from 'zod';
import {
  uploadPurposeValues,
  uploadTypeValues,
} from '../generate-presigned-upload-url/generate-presigned-upload-url.schema.js';

export const initiateMultipartUploadSchema = z.object({
  filename: z.string().min(1, 'Filename is required'),
  contentType: z.string().min(1, 'Content type is required'),
  type: z.enum(uploadTypeValues),
  purpose: z.enum(uploadPurposeValues).optional(),
  partSize: z
    .number()
    .int()
    .min(5 * 1024 * 1024)
    .max(100 * 1024 * 1024)
    .optional(),
  userId: z.string().min(1),
  organizationId: z.string().optional(),
});

export type InitiateMultipartUploadInput = z.infer<
  typeof initiateMultipartUploadSchema
>;
