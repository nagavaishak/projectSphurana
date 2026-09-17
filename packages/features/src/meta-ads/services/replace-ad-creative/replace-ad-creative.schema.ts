import { z } from 'zod';

const creativeFields = {
  videoId: z.string().min(1).optional(),
  graphicId: z.string().min(1).optional(),
};

const exactlyOneCreative = (input: {
  videoId?: string;
  graphicId?: string;
}) => Number(!!input.videoId) + Number(!!input.graphicId) === 1;

const exactlyOneCreativeIssue: { message: string; path: PropertyKey[] } = {
  message: 'Provide exactly one creative: a videoId or a graphicId',
  path: ['videoId'],
};

/** HTTP request body schema; route and organization identifiers are injected. */
export const replaceAdCreativeRequestSchema = z
  .object(creativeFields)
  .refine(exactlyOneCreative, exactlyOneCreativeIssue);

export const replaceAdCreativeSchema = z
  .object({
    adId: z.string().min(1, 'Ad ID is required'),
    organizationId: z.string().min(1, 'Organization ID is required'),
    ...creativeFields,
  })
  .refine(exactlyOneCreative, exactlyOneCreativeIssue);

export type ReplaceAdCreativeInput = z.infer<typeof replaceAdCreativeSchema>;
