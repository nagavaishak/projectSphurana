/**
 * Timing and key constants for custom-domain verification (contract §2 step 3).
 *
 * Kept in one file because every one of them is load-bearing for a behaviour a
 * test pins: the backoff schedule, the 7-day terminal give-up, the lock TTL
 * that makes a concurrent sweep safe, and the host cache key (contract §3)
 * that the renderer reads.
 */

/** BullMQ queue carrying both the verification sweep and the domain_changed fan-out. */
export const MICROSITE_DOMAIN_QUEUE = 'microsite-domain';

/** Job names on that queue. */
export const VERIFY_SWEEP_JOB = 'verify-sweep';
export const DOMAIN_CHANGED_JOB = 'domain-changed';

/** How often the repeatable sweep runs. Per-domain pacing is the backoff below. */
export const SWEEP_INTERVAL_MS = 60_000;

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * The backoff ladder, keyed on time since the domain was added.
 *
 * Tight at the start because a tenant who has just pasted the record is
 * watching the screen, and slack afterwards because most of the 7 days is
 * someone who has not opened their registrar yet. Terminates at the 15-minute
 * plateau the contract names.
 */
export const VERIFY_BACKOFF_LADDER: readonly {
  withinMs: number;
  everyMs: number;
}[] = [
  { withinMs: 10 * MINUTE, everyMs: 30 * SECOND },
  { withinMs: 1 * HOUR, everyMs: 2 * MINUTE },
  { withinMs: 6 * HOUR, everyMs: 5 * MINUTE },
];

/** The plateau every domain reaches. */
export const VERIFY_BACKOFF_MAX_MS = 15 * MINUTE;

/** After this long unverified, the domain goes terminal (`error`) and we email. */
export const VERIFY_GIVE_UP_MS = 7 * DAY;

/** Per-domain lock so two concurrent sweeps cannot both work one domain. */
export const DOMAIN_LOCK_KEY = (domainId: string) =>
  `microsite:domain-verify:lock:${domainId}`;
export const DOMAIN_LOCK_TTL_MS = 60_000;

/** Contract §3 — the host resolution cache the public renderer reads. */
export const HOST_CACHE_KEY = (host: string) => `microsite:host:${host}`;

/** How many domains one sweep will touch. Bounds a cold start after an outage. */
export const SWEEP_BATCH_LIMIT = 200;
