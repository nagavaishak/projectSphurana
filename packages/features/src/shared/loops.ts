import type {
  LoopsContactProperties,
  LoopsService,
  SendEventOptions,
} from '@borradh-workspace/integrations/loops';
import { logError } from '@borradh-workspace/observability';
import { isUndeliverableEmail } from './undeliverable-email.js';

let instance: LoopsService | null = null;
let initFailed = false;

async function getLoopsService(): Promise<LoopsService | null> {
  if (initFailed) return null;
  if (instance) return instance;

  try {
    const { LoopsService: Svc } = await import(
      '@borradh-workspace/integrations/loops'
    );
    instance = new Svc();
    return instance;
  } catch {
    // LOOPS_API_KEY not configured – silently skip all future calls
    initFailed = true;
    return null;
  }
}

/**
 * Fire-and-forget: send a Loops event without blocking the caller.
 * Errors are silently caught – marketing events must never break business logic.
 */
export function fireLoopsEvent(options: SendEventOptions): void {
  if (!options.email && !options.userId) return;
  // Reserved domains cannot receive marketing mail — Loops 400s on every one,
  // and our E2E users are all @example.com. Nothing to send.
  if (options.email && isUndeliverableEmail(options.email)) return;
  getLoopsService()
    .then((svc) => svc?.sendEvent(options))
    .catch((error) =>
      logError('loops.sendEvent', error, {
        feature: 'loops',
        extra: { eventName: options.eventName, email: options.email },
      })
    );
}

/**
 * Fire-and-forget: update a Loops contact without blocking the caller.
 */
export function updateLoopsContact(
  email: string,
  properties: LoopsContactProperties,
  userId?: string
): void {
  if (!email) return;
  if (isUndeliverableEmail(email)) return;
  getLoopsService()
    .then((svc) => svc?.updateContact({ email, properties, userId }))
    .catch((error) =>
      logError('loops.updateContact', error, {
        feature: 'loops',
        extra: { email },
      })
    );
}

// Re-export types for convenience
export type {
  SendEventOptions,
  LoopsContactProperties,
} from '@borradh-workspace/integrations/loops';
