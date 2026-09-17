import { z } from 'zod';

/**
 * Schema for handling Meta's data deletion callback.
 *
 * When a user removes an app from their Facebook settings, Meta sends
 * a POST request with a `signed_request` parameter. We verify the signature
 * and respond with a confirmation URL and code.
 *
 * @see https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback
 */
export const handleMetaDeletionCallbackSchema = z.object({
  signedRequest: z.string().min(1, 'signed_request is required'),
  appSecret: z.string().min(1, 'App secret is required'),
  dataDeletionUrl: z.string().url('Data deletion URL must be a valid URL'),
});

export type HandleMetaDeletionCallbackInput = z.infer<
  typeof handleMetaDeletionCallbackSchema
>;
