import type { ErrorEvent, EventHint } from '@sentry/node';

// Sentry-specific types
export interface SentryConfig {
  dsn?: string;
  environment?: 'development' | 'preview' | 'staging' | 'production';
  release?: string;
  debug?: boolean;
  tracesSampleRate?: number;
  /** Optional event filter — return null to drop an event */
  beforeSend?: (
    event: ErrorEvent,
    hint: EventHint
  ) => ErrorEvent | null | PromiseLike<ErrorEvent | null>;
}

export interface SentryContext {
  user?: {
    id?: string;
    email?: string;
    username?: string;
  };
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}
