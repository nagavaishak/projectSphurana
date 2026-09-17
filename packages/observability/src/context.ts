import { AsyncLocalStorage } from 'node:async_hooks';

export interface ObservabilityContext {
  userId?: string;
  /** Acting user's email — `$set` onto their PostHog person via their own events. */
  userEmail?: string;
  /** Acting user's display name — `$set` onto their PostHog person. */
  userName?: string;
  /**
   * Active organization id for the in-flight request. Used to attribute
   * captured events (incl. `$ai_generation`) to the `organization` PostHog
   * group so usage/cost roll up per org without call-site plumbing.
   */
  organizationId?: string;
  requestId?: string;
  traceId?: string;
  /** HTTP method of the in-flight request (set by the API request-context middleware). */
  httpMethod?: string;
  /** HTTP path of the in-flight request. */
  httpPath?: string;
  /** Originating user-agent of the in-flight request. */
  userAgent?: string;
  /**
   * Feature flag keys currently active for the in-flight execution. Populated
   * by `withFlag()` at the gate site so every `trackedResult` / `tracked` call
   * inside a flag-gated path is automatically attributed without manual plumbing.
   * Multiple flags can be nested (the array is immutable — each `withFlag` call
   * creates a new context rather than mutating the existing one).
   */
  activeFlags?: readonly string[];
}

/**
 * Request-scoped properties to attach to captured exceptions for correlation
 * (request/trace IDs, HTTP method/path, user-agent). Pulled from the ambient
 * context so every `$exception` carries them without call-site plumbing.
 * Returns undefined when no useful field is set (e.g. outside a request).
 */
export const getCurrentRequestProps = ():
  | Record<string, string>
  | undefined => {
  const ctx = getObservabilityContext();
  if (!ctx) return undefined;
  const props: Record<string, string> = {};
  if (ctx.requestId) props.requestId = ctx.requestId;
  if (ctx.traceId) props.traceId = ctx.traceId;
  if (ctx.httpMethod) props.httpMethod = ctx.httpMethod;
  if (ctx.httpPath) props.httpPath = ctx.httpPath;
  if (ctx.userAgent) props.userAgent = ctx.userAgent;
  return Object.keys(props).length > 0 ? props : undefined;
};

// Async local storage for request-scoped observability context
const contextStorage = new AsyncLocalStorage<ObservabilityContext>();

/**
 * Get the current observability context
 */
export const getObservabilityContext = (): ObservabilityContext | undefined => {
  return contextStorage.getStore();
};

/**
 * Get the current user ID from context, or 'anonymous' if not set
 */
export const getCurrentUserId = (): string => {
  return getObservabilityContext()?.userId ?? 'anonymous';
};

/**
 * Get the active organization id from the current context, if any.
 */
export const getCurrentOrganizationId = (): string | undefined => {
  return getObservabilityContext()?.organizationId;
};

/**
 * Set the active organization id in the current context (if one exists).
 * Called by the auth guard so every AI/event capture in the request inherits
 * `organization` group attribution.
 */
export const setContextOrganization = (organizationId: string): void => {
  const ctx = contextStorage.getStore();
  if (ctx) {
    ctx.organizationId = organizationId;
  }
};

/**
 * Run a function within an observability context
 */
export const runWithContext = <T>(
  context: ObservabilityContext,
  fn: () => T
): T => {
  return contextStorage.run(context, fn);
};

/**
 * Set the user ID in the current context (if one exists)
 */
export const setContextUserId = (userId: string): void => {
  const ctx = contextStorage.getStore();
  if (ctx) {
    ctx.userId = userId;
  }
};

/**
 * Set the acting user (id + optional email/name) in the current context.
 * email/name are `$set` onto the user's PostHog person by the tracking wrappers,
 * naming the person from their own events without a separate `$identify` call.
 */
export const setContextUser = (user: {
  id: string;
  email?: string;
  name?: string;
}): void => {
  const ctx = contextStorage.getStore();
  if (ctx) {
    ctx.userId = user.id;
    ctx.userEmail = user.email;
    ctx.userName = user.name;
  }
};

/**
 * Person properties (`email`/`name`) to `$set` for the current acting user,
 * or undefined when none are known. Used by the tracking wrappers.
 */
export const getCurrentUserSetProps = ():
  | { email?: string; name?: string }
  | undefined => {
  const ctx = getObservabilityContext();
  if (!ctx?.userEmail && !ctx?.userName) return undefined;
  return { email: ctx.userEmail, name: ctx.userName };
};

/**
 * Create a new context and run function within it
 * Useful for middleware/interceptors to establish context
 */
export const withObservabilityContext = <T>(
  initialContext: ObservabilityContext,
  fn: () => T
): T => {
  return contextStorage.run(initialContext, fn);
};

/**
 * Returns the feature flag keys currently active in this execution context.
 * Always returns an array (empty when outside a `withFlag` scope or when no
 * context exists). Used by `trackedResult`/`tracked` to auto-stamp
 * `feature_flag_key` on PostHog events without per-call-site plumbing.
 */
export const getActiveFlags = (): readonly string[] => {
  return getObservabilityContext()?.activeFlags ?? [];
};

/**
 * Run `fn` within a context that has `flagKey` added to `activeFlags`.
 * Any `trackedResult` / `tracked` call inside `fn` (at any depth) will
 * automatically include `feature_flag_key: flagKey` in its PostHog event
 * properties so the flag-rollout guardrail can attribute errors to the flag.
 *
 * Multiple flags can be active simultaneously via nesting:
 * ```ts
 * if (await isFeatureOn('flag-a')) {
 *   return withFlag('flag-a', async () => {
 *     if (await isFeatureOn('flag-b')) {
 *       return withFlag('flag-b', () => doWork());
 *     }
 *     return doWork();
 *   });
 * }
 * ```
 *
 * Immutable: each call creates a new child context; the parent context is
 * never modified, so concurrent requests don't interfere.
 */
export const withFlag = <T>(flagKey: string, fn: () => T): T => {
  const parent = getObservabilityContext();
  const existing = parent?.activeFlags ?? [];
  // Avoid duplicates when withFlag is called re-entrantly with the same key.
  if (existing.includes(flagKey)) return fn();
  const child: ObservabilityContext = {
    ...(parent ?? {}),
    activeFlags: [...existing, flagKey],
  };
  return contextStorage.run(child, fn);
};
