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
  type SetActiveOrganizationInput,
  setActiveOrganizationSchema,
} from './set-active-organization.schema.js';

/**
 * Set active organization response
 */
export interface SetActiveOrganizationResponse {
  organization: Organization;
}

/**
 * Auth API interface for set-active-organization
 */
export interface SetActiveOrganizationAuthApi {
  setActiveOrganization: (options: {
    headers: Headers;
    body: { organizationId: string };
    asResponse: true;
  }) => Promise<Response>;
}

/**
 * Internal implementation of set-active-organization
 *
 * Uses Better Auth API to set the active organization
 */
const setActiveOrganizationImpl = async (
  authApi: SetActiveOrganizationAuthApi,
  input: SetActiveOrganizationInput
): Promise<Result<SetActiveOrganizationResponse>> => {
  // Validate input
  const parsed = setActiveOrganizationSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const headers = buildSessionCookieHeaders(parsed.data.sessionToken);

    const response = await authApi.setActiveOrganization({
      headers,
      body: {
        organizationId: parsed.data.organizationId,
      },
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

      if (response.status === 403) {
        return err(
          new FeatureError(
            ErrorCodes.FORBIDDEN,
            'You are not a member of this organization'
          )
        );
      }

      if (response.status === 404) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'Organization not found')
        );
      }

      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { message?: string })?.message ||
        'Failed to set active organization';

      return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, errorMessage));
    }

    const data = (await response.json()) as {
      id: string;
      name: string;
      slug: string;
      logo: string | null;
      createdAt: string;
      metadata?: Record<string, unknown> | null;
    };

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
    logError('organizations.setActiveOrganization', error, {
      feature: 'organizations',
    });
    return internalError(
      'An error occurred while setting the active organization. Please try again.',
      error
    );
  }
};

/**
 * Set the current user's active organization
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth) - kept for backward compatibility
 * @param input - Input with session token and organization ID
 * @returns Result with the activated organization
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await setActiveOrganization(auth.api, {
 *   sessionToken: 'session-token-here',
 *   organizationId: 'org-id-here',
 * });
 *
 * if (result.success) {
 *   console.log('Active organization set:', result.data.organization);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const setActiveOrganization = (
  authApi: SetActiveOrganizationAuthApi,
  input: SetActiveOrganizationInput
) =>
  trackedResult(
    'organizations.setActiveOrganization',
    () => setActiveOrganizationImpl(authApi, input),
    {
      properties: { organizationId: input.organizationId },
    }
  );

/**
 * Result type for setActiveOrganization
 */
export type SetActiveOrganizationResult = Awaited<
  ReturnType<typeof setActiveOrganization>
>;
