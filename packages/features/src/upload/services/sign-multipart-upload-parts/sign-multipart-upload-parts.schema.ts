import { z } from 'zod';
import {
  uploadPurposeValues,
  uploadTypeValues,
} from '../generate-presigned-upload-url/generate-presigned-upload-url.schema.js';

export const signMultipartUploadPartsSchema = z.object({
  key: z.string().min(1, 'S3 key is required'),
  uploadId: z.string().min(1, 'Upload id is required'),
  type: z.enum(uploadTypeValues),
  purpose: z.enum(uploadPurposeValues).optional(),
  partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(100),
  expiresIn: z.number().int().min(60).max(3600).optional(),
  userId: z.string().min(1),
  organizationId: z.string().optional(),
});

export type SignMultipartUploadPartsInput = z.infer<
  typeof signMultipartUploadPartsSchema
>;
