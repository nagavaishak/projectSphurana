/**
 * @borradh-workspace/api-client - Auth API Types
 *
 * Types for authentication-related API endpoints.
 * These are frontend-safe types (no server-side dependencies).
 */

/**
 * User entity from session
 */
/**
 * Calendar tint palette. Assigned per-practitioner (org-scoped) — see
 * Practitioner.color. Kept here so the auth User and api-client consumers can
 * import a stable type without reaching into another module.
 */
export type UserColor =
  | 'blue'
  | 'green'
  | 'red'
  | 'yellow'
  | 'purple'
  | 'orange';

export interface User {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  role?: 'user' | 'admin';
  twoFactorEnabled?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Session entity
 *
 * Note: `token` is intentionally excluded - session tokens are managed
 * via HttpOnly cookies and must never be exposed to frontend code.
 */
export interface Session {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  activeOrganizationId: string | null;
  /** Set when an admin is impersonating this user */
  impersonatedBy?: string;
  /** Intercom identity verification JWT (present when INTERCOM_IDENTITY_SECRET is configured) */
  intercomJwt?: string;
}

/**
 * Session response from GET /auth/session
 */
export interface SessionResponse {
  user: User;
  session: Session;
}

/**
 * Check-email response from POST /auth/check-email
 * Indicates how user can sign in
 */
export interface CheckEmailResponse {
  /** Whether the email exists in the system */
  exists: boolean;
  /** Whether the user has a password (signed up with email/password) */
  hasPassword: boolean;
  /** Available OAuth providers for this user */
  providers: string[];
}

/**
 * Sign-out response from POST /auth/sign-out
 */
export interface SignOutResponse {
  success: boolean;
}

/**
 * Change password input
 */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}

/**
 * Change password response
 */
export interface ChangePasswordResponse {
  success: boolean;
  message: string;
}

/**
 * Sign-in input
 */
export interface SignInInput {
  email: string;
  password: string;
}

/**
 * Sign-in response
 */
export interface SignInResponse {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string;
  };
}

/**
 * Sign-up input
 */
export interface SignUpInput {
  email: string;
  password: string;
  name: string;
}

/**
 * Sign-up response
 */
export interface SignUpResponse {
  user: {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string;
  };
}
