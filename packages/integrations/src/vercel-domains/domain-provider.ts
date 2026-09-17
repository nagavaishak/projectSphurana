/**
 * THE PORT for custom-domain provisioning — provider-neutral, on purpose.
 *
 * A single Vercel project has a domain cap and per-request certificate
 * issuance limits (microsites plan §9). Fine at a few hundred tenants; past
 * that the answer is Cloudflare for SaaS (`POST /custom_hostnames`), which is
 * purpose-built and effectively uncapped. So provisioning goes behind this
 * interface FROM THE FIRST LINE, not after the cap is hit: the swap must be one
 * adapter, not a migration.
 *
 * The rule that keeps that true: **nothing outside the adapter directory may
 * mention Vercel** — not a type name, not a field, not a status string. The
 * shapes below are the only vocabulary the services, the queue and the database
 * are allowed to speak. `microsite_domain.verification` is typed open
 * (`MicrositeDomainVerification`) for the same reason; putting a Vercel-shaped
 * field in it would make the swap a data migration.
 *
 * ## Idempotency is part of the contract, not an implementation detail
 *
 * `add` and `remove` run inside a BullMQ job, and BullMQ retries. "Already
 * exists" and "already gone" are therefore the NORMAL second call and MUST be
 * reported as success — `alreadyExisted` / `alreadyRemoved` tell the caller
 * which happened without changing the result branch. An adapter that returns an
 * error here turns a healthy retry into a domain stuck in `error`.
 *
 * `verify` has NO side effects: it is polled on a schedule and must be safe to
 * call arbitrarily often.
 */

/**
 * One DNS record the tenant has to create. Maps 1:1 onto
 * `MicrositeDomainVerification.records`, which is why it carries no provider
 * fields — a record is a record on any provider.
 */
export interface DomainDnsRecord {
  /** `A`, `CNAME`, `TXT`. Uppercase. */
  type: string;
  /** Record name — `@` for the apex, `www`, or a challenge label. */
  name: string;
  value: string;
  /**
   * What this record is for. `routing` records point traffic at us;
   * `challenge` records prove ownership and can usually be deleted afterwards.
   */
  purpose?: 'routing' | 'challenge';
}

/**
 * Neutral lifecycle state. Deliberately the same four values as
 * `MicrositeDomainStatus` minus the `removed` tombstone, which is OUR
 * bookkeeping and not something a provider can report.
 */
export type DomainState = 'pending_dns' | 'verifying' | 'active' | 'error';

/** Result of `add`. */
export interface AddedDomain {
  /** The domain as the provider recorded it (normalised, lowercase). */
  domain: string;
  /**
   * TRUE when the domain was already attached to our project and this call was
   * a no-op. A retry, in other words — not an error.
   */
  alreadyExisted: boolean;
  /** Records the tenant must create. Empty when the provider needs none. */
  records: DomainDnsRecord[];
  /** Opaque provider handle, stored in `verification.providerRef`. */
  providerRef?: string;
  /** Best-known state at the moment of the add. Usually `pending_dns`. */
  state: DomainState;
}

/** Result of `verify` — a snapshot, never a mutation. */
export interface DomainStatus {
  domain: string;
  state: DomainState;
  /** Outstanding records. Empty once `state` is `active`. */
  records: DomainDnsRecord[];
  providerRef?: string;
  /**
   * Human-readable reason the domain is not yet `active`. Safe to show a
   * tenant: adapters MUST NOT put credentials, headers or raw payloads here.
   */
  message?: string;
}

/** Result of `remove`. */
export interface RemovedDomain {
  domain: string;
  /** TRUE when the domain was not attached in the first place. Still success. */
  alreadyRemoved: boolean;
}

/**
 * Error codes the port may report. Intentionally a small, provider-independent
 * set — services map these onto `ErrorCodes` without knowing who produced them.
 */
export const DomainProviderErrorCodes = {
  /** The provider rejected the name itself. */
  INVALID_DOMAIN: 'INVALID_DOMAIN',
  /** Attached to a DIFFERENT project/account. Not ours to take. */
  DOMAIN_CLAIMED: 'DOMAIN_CLAIMED',
  /** Domain is not attached to our project (only `verify` reports this). */
  NOT_FOUND: 'NOT_FOUND',
  /** Provider credentials missing or rejected. */
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  /** Back off and retry — the job scheduler's cue, not a failure. */
  RATE_LIMITED: 'RATE_LIMITED',
  /** Anything else, including transport failures. */
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const;

export type DomainProviderErrorCode =
  (typeof DomainProviderErrorCodes)[keyof typeof DomainProviderErrorCodes];

/**
 * Structurally identical to the features package's `FeatureError` JSON shape,
 * so a `Result<T, FeatureError>` from a test double satisfies this port and a
 * service can rebuild a real `FeatureError` from it with one helper. Declared
 * here rather than imported because `integrations` sits BELOW `features` in the
 * dependency graph and must stay there.
 */
export interface DomainProviderError {
  code: DomainProviderErrorCode | string;
  message: string;
  details?: Record<string, unknown>;
}

/** The `Result<T>` shape the whole workspace uses, restated for this layer. */
export type DomainProviderResult<T> =
  | { success: true; data: T }
  | { success: false; error: DomainProviderError };

/** See the file header. Three methods; two of them idempotent. */
export interface DomainProvider {
  /** Attach a domain. Idempotent: "already attached" is success. */
  add(domain: string): Promise<DomainProviderResult<AddedDomain>>;
  /** Poll ownership/config. Read-only — safe to call on a schedule. */
  verify(domain: string): Promise<DomainProviderResult<DomainStatus>>;
  /** Detach a domain. Idempotent: "already gone" is success. */
  remove(domain: string): Promise<DomainProviderResult<RemovedDomain>>;
}

/** Convenience constructors so adapters do not hand-roll the union. */
export const providerOk = <T>(data: T): DomainProviderResult<T> => ({
  success: true,
  data,
});

export const providerErr = (
  code: DomainProviderErrorCode | string,
  message: string,
  details?: Record<string, unknown>
): DomainProviderResult<never> => ({
  success: false,
  error: { code, message, ...(details ? { details } : {}) },
});
