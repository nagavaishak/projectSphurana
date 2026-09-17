import {
  addBreadcrumb,
  isPostHogInitialized,
  isSentryInitialized,
  trackEvent,
} from '@borradh-workspace/observability';

/**
 * Intentional Claire telemetry.
 *
 * Per `feedback_posthog_no_trackedresult`, PostHog events are only emitted
 * when explicitly called — no auto-tracking. Sentry breadcrumbs are added on
 * every event for debugging.
 *
 * Events shipped in C-02:
 *   - claire.tool_called      (every tool dispatch)
 *   - claire.tool_failed      (tool execute threw or returned error)
 *   - claire.tool_confirmed   (a confirmation token was verified, action proceeded)
 *   - claire.opus_routed      (the orchestrator routed the turn to Opus 4.7)
 *
 * C-04 lands the rest of the 13 intentional events.
 */

interface BaseProps {
  toolName: string;
  organizationId: string;
  conversationId: string;
}

export interface ToolCalledProps extends BaseProps {
  destructive: boolean;
}

export interface ToolFailedProps extends BaseProps {
  errorCode?: string;
  errorMessage?: string;
}

export interface ToolConfirmedProps extends BaseProps {
  action: string;
}

export interface OpusRoutedProps {
  organizationId: string;
  conversationId: string;
  /** Skill IDs whose `preferredModel: 'opus'` flag triggered the routing. */
  skillIds: string[];
}

function emitBreadcrumb(
  level: 'info' | 'warning' | 'error',
  message: string,
  data: Record<string, unknown>
): void {
  if (!isSentryInitialized()) return;
  addBreadcrumb({
    message,
    category: 'claire.tool',
    level,
    data,
  });
}

export function trackToolCalled(userId: string, props: ToolCalledProps): void {
  emitBreadcrumb('info', `Tool called: ${props.toolName}`, { ...props });
  if (isPostHogInitialized()) {
    trackEvent(userId, 'claire.tool_called', { ...props });
  }
}

export function trackToolFailed(userId: string, props: ToolFailedProps): void {
  emitBreadcrumb('error', `Tool failed: ${props.toolName}`, { ...props });
  if (isPostHogInitialized()) {
    trackEvent(userId, 'claire.tool_failed', { ...props });
  }
}

export function trackToolConfirmed(
  userId: string,
  props: ToolConfirmedProps
): void {
  emitBreadcrumb('info', `Tool confirmed: ${props.toolName}`, { ...props });
  if (isPostHogInitialized()) {
    trackEvent(userId, 'claire.tool_confirmed', { ...props });
  }
}

export function trackOpusRouted(userId: string, props: OpusRoutedProps): void {
  emitBreadcrumb('info', 'Opus 4.7 routed', { ...props });
  if (isPostHogInitialized()) {
    trackEvent(userId, 'claire.opus_routed', {
      organizationId: props.organizationId,
      conversationId: props.conversationId,
      // PostHog event properties are flat scalars; flatten skill IDs.
      skillIds: props.skillIds.join(','),
    });
  }
}
