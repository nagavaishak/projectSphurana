/**
 * Response from change email operation
 */
export interface ChangeEmailResponse {
  success: boolean;
  message: string;
}

/**
 * Auth API interface for change email
 * Defines the shape of the auth.api.changeEmail method from better-auth
 *
 * Note: We use a permissive type to accept Better Auth's complex InferAPI type.
 * The actual call uses asResponse: true to get a Response object back.
 */
export interface ChangeEmailAuthApi {
  changeEmail: (options: {
    body: {
      newEmail: string;
      callbackURL?: string;
    };
    headers?: Headers;
    asResponse?: boolean;
  }) => Promise<Response | Record<string, unknown>>;
}
