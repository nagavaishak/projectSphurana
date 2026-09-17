/**
 * Response from change password operation
 */
export interface ChangePasswordResponse {
  success: boolean;
  message: string;
}

/**
 * Auth API interface for change password
 * Defines the shape of the auth.api.changePassword method from better-auth
 *
 * Note: We use a permissive type to accept Better Auth's complex InferAPI type.
 * The actual call uses asResponse: true to get a Response object back.
 */
export interface ChangePasswordAuthApi {
  changePassword: (options: {
    body: {
      currentPassword: string;
      newPassword: string;
      revokeOtherSessions?: boolean;
    };
    headers?: Headers;
    asResponse?: boolean;
  }) => Promise<Response | Record<string, unknown>>;
}
