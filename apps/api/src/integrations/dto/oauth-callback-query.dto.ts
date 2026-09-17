import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * The query string every provider OAuth callback receives.
 *
 * `state` is deliberately ABSENT. It is consumed by `OAuthStateGuard` and
 * surfaced already-verified through `@OAuthState()`; leaving it out of the DTO
 * means a handler cannot accidentally reach for the raw, unverified value —
 * which is precisely the mistake that made these callbacks forgeable.
 *
 * Providers spell the failure fields in snake_case, so they are renamed here
 * rather than in nine handlers.
 */
export const oauthCallbackQuerySchema = z
  .object({
    code: z.string().optional(),
    error: z.string().optional(),
    error_reason: z.string().optional(),
    error_description: z.string().optional(),
    // Google My Business only; harmless elsewhere.
    locationId: z.string().optional(),
    accountName: z.string().optional(),
  })
  .transform((q) => ({
    code: q.code,
    oauthError: q.error,
    oauthErrorReason: q.error_reason,
    oauthErrorDescription: q.error_description,
    locationId: q.locationId,
    accountName: q.accountName,
  }));

export type OAuthCallbackQuery = z.infer<typeof oauthCallbackQuerySchema>;

export class OAuthCallbackQueryDto extends createZodDto(
  oauthCallbackQuerySchema
) {}
