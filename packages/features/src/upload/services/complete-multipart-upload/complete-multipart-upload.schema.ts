import { z } from 'zod';
import {
  uploadPurposeValues,
  uploadTypeValues,
} from '../generate-presigned-upload-url/generate-presigned-upload-url.schema.js';

export const completeMultipartUploadSchema = z.object({
  key: z.string().min(1, 'S3 key is required'),
  uploadId: z.string().min(1, 'Upload id is required'),
  type: z.enum(uploadTypeValues),
  purpose: z.enum(uploadPurposeValues).optional(),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10_000),
        etag: z.string().min(1, 'Part ETag is required'),
      })
    )
    .min(1),
  userId: z.string().min(1),
  organizationId: z.string().optional(),
});

export type CompleteMultipartUploadInput = z.infer<
  typeof completeMultipartUploadSchema
>;
