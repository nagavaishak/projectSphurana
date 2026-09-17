// @borradh-workspace/api-client - Shared types

import type { Options } from 'ky';
import type { ResponseParseConfig, ResponseSchema } from './parse.js';

/**
 * Function that provides an auth token
 * Called before each request to get the current token
 */
export type AuthProvider = () => Promise<string | undefined>;

/**
 * API error information
 */
export interface ApiError {
  /** HTTP status code */
  status: number;
  /** Human-readable error message */
  message: string;
  /** Error code from the API (e.g., 'VALIDATION_ERROR', 'NOT_FOUND') */
  code?: string;
  /** Additional error details */
  details?: Record<string, unknown>;
}

/**
 * Configuration for the API client
 */
export interface ApiClientConfig {
  /** Base URL for all API requests (e.g., '/api' for Next.js rewrite) */
  baseUrl: string;
  /**
   * Direct API URL for auth endpoints (e.g., 'https://api.example.com/api')
   *
   * When set, auth/* endpoints use this URL directly instead of baseUrl.
   * This is required for web apps using Next.js rewrites because rewrites
   * don't forward Set-Cookie headers from external origins.
   *
   * For React Native apps, this can be the same as baseUrl since there's
   * no rewrite proxy.
   */
  authUrl?: string;
  /** Function to get auth token for Authorization header */
  authProvider?: AuthProvider;
  /** Custom headers to include with every request */
  headers?: Record<string, string>;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Number of retry attempts for failed requests (default: 2) */
  retry?: number;
  /** Global error handler called for all error responses */
  onError?: (error: ApiError) => void;
  /**
   * Optional response-parse controls (mode/kill-switch/telemetry). When a
   * request passes a `schema`, responses are validated against it. Defaults to
   * report mode with console logging when omitted.
   */
  responseParse?: ResponseParseConfig;
}

/**
 * Options for individual API requests.
 *
 * Pass `schema` to validate the response at runtime against a contracts schema.
 * The generic `T` should match the schema's inferred output type.
 */
export type RequestOptions<T = unknown> = Omit<Options, 'json'> & {
  /** Optional contracts schema to validate/parse the response against. */
  schema?: ResponseSchema<T>;
};
