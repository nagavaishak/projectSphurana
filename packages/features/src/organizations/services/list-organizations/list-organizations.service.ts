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
  type ListOrganizationsInput,
  listOrganizationsSchema,
} from './list-organizations.schema.js';

/**
 * List organizations response
 */
export interface ListOrganizationsResponse {
  organizations: Organization[];
}

/**
 * Auth API interface for list-organizations
 */
export interface ListOrganizationsAuthApi {
  listOrganizations: (options: {
    headers: Headers;
    asResponse: true;
  }) => Promise<Response>;
}

/**
 * Internal implementation of list-organizations
 *
 * Uses Better Auth API to list organizations the user is a member of
 */
const listOrganizationsImpl = async (
  authApi: ListOrganizationsAuthApi,
  input: ListOrganizationsInput
): Promise<Result<ListOrganizationsResponse>> => {
  // Validate input
  const parsed = listOrganizationsSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  try {
    const headers = buildSessionCookieHeaders(parsed.data.sessionToken);

    const response = await authApi.listOrganizations({
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
        'Failed to list organizations';

      return err(new FeatureError(ErrorCodes.INTERNAL_ERROR, errorMessage));
    }

    const data = (await response.json()) as Array<{
      id: string;
      name: string;
      slug: string;
      logo: string | null;
      createdAt: string;
      metadata?: Record<string, unknown> | null;
    }>;

    const organizations: Organization[] = data.map((org) => ({
      id: org.id,
      name: org.name,
      slug: org.slug,
      logo: org.logo,
      createdAt: new Date(org.createdAt),
      metadata: org.metadata ?? null,
    }));

    return ok({ organizations });
  } catch (error) {
    logError('organizations.listOrganizations', error, {
      feature: 'organizations',
    });
    return internalError(
      'An error occurred while listing organizations. Please try again.',
      error
    );
  }
};

/**
 * List all organizations the current user is a member of
 *
 * @param authApi - Auth API instance (e.g., auth.api from Better Auth)
 * @param input - Input with session token
 * @returns Result with array of organizations
 *
 * @example
 * ```ts
 * import { auth } from '@borradh-workspace/auth/server';
 *
 * const result = await listOrganizations(auth.api, {
 *   sessionToken: 'session-token-here',
 * });
 *
 * if (result.success) {
 *   console.log('Organizations:', result.data.organizations);
 * } else {
 *   console.error('Error:', result.error.message);
 * }
 * ```
 */
export const listOrganizations = (
  authApi: ListOrganizationsAuthApi,
  input: ListOrganizationsInput
) =>
  trackedResult(
    'organizations.listOrganizations',
    () => listOrganizationsImpl(authApi, input),
    {
      properties: { hasSessionToken: !!input.sessionToken },
    }
  );

/**
 * Result type for listOrganizations
 */
export type ListOrganizationsResult = Awaited<
  ReturnType<typeof listOrganizations>
>;
