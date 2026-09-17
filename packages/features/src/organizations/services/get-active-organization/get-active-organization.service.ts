import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  buildSessionCookieHeaders,
  err,
  internalError,
  ok,
} from '../../../shared/index.js';
import type { Organization } from '../../models/index.js';
import {
  type GetActiveOrganizationInput,
  getActiveOrganizationSchema,
} from './get-active-organization.schema.js';

/**
 * Active organization response
 */
export interface GetActiveOrganizationResponse {
  organization: Organization | null;
}

/**
 * Auth API interface for get-active-organization
 */
export interface GetActiveOrganizationAuthApi {
  getFullOrganization: (options: {
    headers: Headers;
    asResponse: true;
  }) => Promise<Response>;
}

/**
 * Internal implementation of get-active-organization
 *
 * Uses Better Auth API to get the active organization
 */
const getActiveOrganizationImpl = async (
  authApi: GetActiveOrganizationAuthApi,
  input: GetActiveOrganizationInput
): Promise<Result<GetActiveOrganizationResponse>> => {
  // Validate input
  const parsed = getActiveOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const headers = buildSessionCookieHeaders(parsed.data.sessionToken);

    const response = await authApi.getFullOrganization({
      headers,
      asResponse: true,
    });

    if (!response.ok) {
      if (response.status === 401) {
        return err(
          new FeatureError(
            ErrorCodes.UNAUTHORIZED,
            'Invalid or expired session'
          )
        );
      }

      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { message?: string })?.message ||
        'Failed to get active organization';

      // Better Auth returns 400 with "Organization not found" when the
      // active org no longer exists — map to NOT_FOUND
      if (errorMessage === 'Organization not found') {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
        );
      }

      return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, errorMessage));
    }

    const data = (await response.json()) as {
      id: string;
      name: string;
      slug: string;
      logo: string | null;
      createdAt: string;
      metadata?: Record<string, unknown> | null;
    } | null;

    // If no active organization is set, return null
    if (!data) {
      return ok({ organization: null });
    }

    return ok({
      organization: {
        id: data.id,
        name: data.name,
        slug: data.slug,
        logo: data.logo,
        createdAt: new Date(data.createdAt),
        metadata: data.metadata ?? null,
      },
    });
  } catch (error) {
    logError('organizations.getActiveOrganization', error, {
      feature: 'organizations',
    });
    return internalError(
      'An error occurred while getting the active organization. Please try again.',
      error
    );
  }
};

/**
 * Get the current user's active organization
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Input with session token
 * @returns Result with active organization or null
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await getActiveOrganization(auth.api, {
 *   sessionToken: 'session-token-here',
 * });
 *
 * if (result.success) {
 *   console.log('Active organization:', result.data.organization);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const getActiveOrganization = (
  authApi: GetActiveOrganizationAuthApi,
  input: GetActiveOrganizationInput
) =>
  trackedResult(
    'organizations.getActiveOrganization',
    () => getActiveOrganizationImpl(authApi, input),
    {
      properties: { hasSessionToken: !!input.sessionToken },
      internalErrorsOnly: true,
    }
  );

/**
 * Result type for getActiveOrganization
 */
export type GetActiveOrganizationResult = Awaited<
  ReturnType<typeof getActiveOrganization>
>;
