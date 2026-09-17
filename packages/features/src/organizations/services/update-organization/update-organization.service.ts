import {
  identifyOrganization,
  logError,
  trackedResult,
} from '@borradh-workspace/observability';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  internalError,
  ok,
} from '../../../shared/index.js';
import type { Organization } from '../../models/index.js';
import {
  type UpdateOrganizationInternalInput,
  updateOrganizationInternalSchema,
} from './update-organization.schema.js';

/**
 * Update organization response
 */
export interface UpdateOrganizationResponse {
  organization: Organization;
}

/**
 * Auth API interface for update-organization
 */
export interface UpdateOrganizationAuthApi {
  updateOrganization: (options: {
    headers: { authorization: string };
    body: {
      data: {
        name?: string;
        logo?: string | null;
      };
    };
    asResponse: true;
  }) => Promise<Response>;
}

/**
 * Internal implementation of update-organization
 */
const updateOrganizationImpl = async (
  authApi: UpdateOrganizationAuthApi,
  input: UpdateOrganizationInternalInput
): Promise<Result<UpdateOrganizationResponse>> => {
  // Validate input
  const parsed = updateOrganizationInternalSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { sessionToken, ...updateData } = parsed.data;

  try {
    // Use provided auth API to update organization
    const response = await authApi.updateOrganization({
      headers: {
        authorization: `Bearer ${sessionToken}`,
      },
      body: {
        data: updateData,
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
            'You do not have permission to update this organization'
          )
        );
      }

      if (response.status === 404) {
        return err(
          new FeatureError(ErrorCodes.NOT_FOUND, 'No active organization found')
        );
      }

      const errorData = await response.json().catch(() => ({}));
      const errorMessage =
        (errorData as { message?: string })?.message ||
        'Failed to update organization';

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

    // Keep the PostHog `organization` group name in sync on rename so events
    // attributed to this org keep rendering with the current readable name.
    identifyOrganization(data.id, { name: data.name, slug: data.slug });

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
    logError('organizations.updateOrganization', error, {
      feature: 'organizations',
    });
    return internalError(
      'An error occurred while updating the organization. Please try again.',
      error
    );
  }
};

/**
 * Update the current user's active organization
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Input with session token and update data
 * @returns Result with updated organization
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await updateOrganization(auth.api, {
 *   sessionToken: 'session-token-here',
 *   name: 'New Organization Name',
 *   logo: 'https://example.com/logo.png',
 * });
 *
 * if (result.success) {
 *   console.log('Updated organization:', result.data.organization);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const updateOrganization = (
  authApi: UpdateOrganizationAuthApi,
  input: UpdateOrganizationInternalInput
) =>
  trackedResult(
    'organizations.updateOrganization',
    () => updateOrganizationImpl(authApi, input),
    {
      properties: { hasName: !!input.name },
    }
  );

/**
 * Result type for updateOrganization
 */
export type UpdateOrganizationResult = Awaited<
  ReturnType<typeof updateOrganization>
>;
