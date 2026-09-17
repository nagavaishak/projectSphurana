import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

// The handler maps import the real feature services (and therefore drizzle +
// its ESM-only deps), which jest cannot load. We only need their KEY SETS, so
// stub the heavy edges — the same precedent as tool-registry.spec.ts. The
// registry and the maps themselves are the real thing.
jest.mock('@borradh-workspace/database', () => ({
  db: {},
  withSystemScope: jest.fn(),
}));
jest.mock('@borradh-workspace/env/api', () => ({ apiEnv: {} }));
jest.mock('@borradh-workspace/features/conversations', () => ({
  handleIncomingMessage: jest.fn(),
  handleStandaloneReferral: jest.fn(),
  recordEchoMessage: jest.fn(),
}));
jest.mock('@borradh-workspace/features/lead-forms', () => ({
  handleMetaLeadWebhook: jest.fn(),
}));
jest.mock('@borradh-workspace/features/appointments', () => ({
  handleDepositWebhook: jest.fn(),
}));
jest.mock('@borradh-workspace/features/integrations', () => ({
  syncStripeAccountStatus: jest.fn(),
}));
jest.mock('@borradh-workspace/features/memberships', () => ({
  handleMembershipSubscriptionWebhook: jest.fn(),
}));
jest.mock('@borradh-workspace/features/payments', () => ({
  handlePaymentWebhook: jest.fn(),
}));
jest.mock('@borradh-workspace/features/sales', () => ({
  handleSalePaymentWebhook: jest.fn(),
}));

import {
  allWebhookEvents,
  deliveredAsPairs,
  handledEventTypes,
  instagramSubscribedFields,
  metaPageSubscribedFields,
  providerSubscriptionSource,
  webhookProviders,
} from '@borradh-workspace/integrations/webhooks';
import {
  instagramHandlers,
  metaPageHandlers,
} from './meta/meta-webhook-handlers.js';
import { stripeConnectHandlers } from './stripe-connect/stripe-connect-handlers.js';

/**
 * THE GATE: subscribed ⇔ handled.
 *
 * Every input below is DERIVED — from the registry, from the handler maps, or
 * by reading the dispatch source itself. Nothing here is a hand-typed list of
 * event names, because a hand-typed list is exactly what let `feed` be
 * subscribed by three code paths and handled by none.
 */

const REPO_ROOT = resolve(__dirname, '../../../..');

const walk = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.'))
      continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') || full.endsWith('.mjs')) out.push(full);
  }
  return out;
};

const sourceFiles = (): string[] => [
  ...walk(join(REPO_ROOT, 'packages/integrations/src')),
  ...walk(join(REPO_ROOT, 'packages/features/src')),
  ...walk(join(REPO_ROOT, 'apps/api/src')),
  ...walk(join(REPO_ROOT, 'scripts')),
];

const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** The `case '<x>':` labels of a switch — derived from the dispatch source. */
const switchCaseLabels = (source: string, after: string): string[] => {
  const body = source.slice(source.indexOf(after));
  return [...body.matchAll(/^\s*case '([^']+)':/gm)].map((m) => m[1] as string);
};

describe('webhook registry', () => {
  describe('declarations', () => {
    it('declares every event exactly once per provider', () => {
      const seen = new Set<string>();
      const dupes: string[] = [];
      for (const e of allWebhookEvents) {
        const key = `${e.provider}:${e.type}`;
        if (seen.has(key)) dupes.push(key);
        seen.add(key);
      }
      expect(dupes).toEqual([]);
    });

    it('gives every dropped event a written reason a human can review', () => {
      const weak = allWebhookEvents
        .filter((e) => e.disposition.kind === 'ignored')
        .filter(
          (e) =>
            e.disposition.kind === 'ignored' &&
            e.disposition.because.trim().length < 20
        )
        .map((e) => `${e.provider}:${e.type}`);
      // `ignoredBecause` is the exempt(why) escape hatch — "n/a" is not a reason.
      expect(weak).toEqual([]);
    });

    it('covers every provider', () => {
      for (const provider of webhookProviders) {
        expect(
          allWebhookEvents.filter((e) => e.provider === provider).length
        ).toBeGreaterThan(0);
      }
    });
  });

  describe('subscribed ⇔ handled', () => {
    it('subscribes a Meta Page to exactly what it handles plus its deliveredAs fields — no more, no less', () => {
      expect([...metaPageSubscribedFields].sort()).toEqual(
        [
          ...handledEventTypes('meta_page'),
          ...deliveredAsPairs('meta_page').map((p) => p.type),
        ].sort()
      );
      // The whole point: a field we do not consume cannot be subscribed.
      const ignored = allWebhookEvents
        .filter(
          (e) => e.provider === 'meta_page' && e.disposition.kind === 'ignored'
        )
        .map((e) => e.type);
      for (const type of ignored) {
        expect(metaPageSubscribedFields).not.toContain(type);
      }
    });

    it('subscribes Instagram to exactly the fields it handles', () => {
      expect([...instagramSubscribedFields].sort()).toEqual(
        [
          ...handledEventTypes('instagram'),
          ...deliveredAsPairs('instagram').map((p) => p.type),
        ].sort()
      );
    });

    it('every deliveredAs field points at a type that is actually handled', () => {
      // Closes the loophole the new disposition opens: without this,
      // `deliveredAs('typo', ...)` would subscribe a field whose events reach
      // no handler — precisely the `feed` failure the registry exists to stop.
      const dangling: string[] = [];
      for (const provider of webhookProviders) {
        const handled = handledEventTypes(provider);
        for (const { type, as } of deliveredAsPairs(provider)) {
          if (!handled.includes(as)) {
            dangling.push(`${provider}:${type} -> ${as}`);
          }
        }
      }
      expect(dangling).toEqual([]);
    });

    it('subscribes Messenger to message_echoes, without which agent takeover is dead', () => {
      // ENG-813: this field was absent, so a clinic replying from Meta's own
      // inbox never stood Claire down. Named explicitly because the derived
      // set-equality above would stay green if the declaration were deleted.
      expect(metaPageSubscribedFields).toContain('message_echoes');
    });

    it.each([
      ['meta_page', () => Object.keys(metaPageHandlers)],
      ['instagram', () => Object.keys(instagramHandlers)],
      ['stripe_connect', () => Object.keys(stripeConnectHandlers)],
    ] as const)(
      '%s: the router binds a handler for every handled event and nothing else',
      (provider, keys) => {
        const declared = [...handledEventTypes(provider)].sort();
        const bound = [...keys()].sort();

        const missingHandler = declared.filter((t) => !bound.includes(t));
        const orphanHandler = bound.filter((t) => !declared.includes(t));

        // Named, not just counted — a red gate must tell you WHICH event.
        expect({ missingHandler, orphanHandler }).toEqual({
          missingHandler: [],
          orphanHandler: [],
        });
      }
    );

    it('meta handlers agree with the registry about how each event is delivered', () => {
      const mismatches: string[] = [];
      for (const [provider, handlers] of [
        ['meta_page', metaPageHandlers],
        ['instagram', instagramHandlers],
      ] as const) {
        for (const event of allWebhookEvents) {
          if (event.provider !== provider) continue;
          if (event.disposition.kind !== 'handled') continue;
          const handler = (handlers as Record<string, { delivery: string }>)[
            event.type
          ];
          if (handler && handler.delivery !== event.delivery) {
            mismatches.push(
              `${provider}:${event.type} registry=${event.delivery} handler=${handler.delivery}`
            );
          }
        }
      }
      expect(mismatches).toEqual([]);
    });
  });

  describe('switch-shaped dispatchers (derived from their own source)', () => {
    // The switch moved out of the controller into its dispatch module (Gate 5:
    // a controller may only call the use case and return it). The invariant is
    // unchanged — it now reads the file that actually holds the switch.
    it('the WhatsApp dispatcher has a case for every handled WhatsApp event and no others', () => {
      const source = read(
        'apps/api/src/webhooks/whatsapp/whatsapp-webhook-dispatch.ts'
      );
      const cases = switchCaseLabels(source, 'switch (change.field)').sort();
      expect(cases).toEqual([...handledEventTypes('whatsapp')].sort());
    });

    it('the billing webhook service has a case for every handled stripe_billing event and no others', () => {
      const source = read(
        'packages/features/src/billing/services/handle-stripe-webhook/handle-stripe-webhook.service.ts'
      );
      const cases = switchCaseLabels(source, 'switch (event.type)').sort();
      expect(cases).toEqual([...handledEventTypes('stripe_billing')].sort());
    });
  });

  describe('no hand-written lists survive', () => {
    const ALLOWED_FIELD_LIST_FILES = [
      // The registry itself, and the classifier that maps a wire event back to
      // the field that produced it. Both ARE the single source.
      'packages/integrations/src/webhooks/events.ts',
      'packages/integrations/src/webhooks/classify.ts',
      'apps/api/src/webhooks/webhook-registry.spec.ts',
    ];

    it('no file outside the registry hand-types a Meta subscription field list', () => {
      // `messaging_postbacks` appeared in EVERY one of the seven hand-copied
      // lists and legitimately appears nowhere else. If it shows up in a new
      // file, someone has started copying the list again.
      const offenders = sourceFiles()
        .filter((f) => readFileSync(f, 'utf8').includes('messaging_postbacks'))
        .map((f) => f.slice(REPO_ROOT.length + 1))
        .filter((f) => !ALLOWED_FIELD_LIST_FILES.includes(f));
      expect(offenders).toEqual([]);
    });

    it('every subscribed_fields call site passes a derived value, never an array literal', () => {
      const offenders: string[] = [];
      for (const file of sourceFiles()) {
        const src = readFileSync(file, 'utf8');
        for (const m of src.matchAll(/subscribed_fields:\s*(.)/g)) {
          if (m[1] === '[') offenders.push(file.slice(REPO_ROOT.length + 1));
        }
      }
      expect(offenders).toEqual([]);
    });

    it('the Graph API version is declared in exactly one place in product source', () => {
      // `scripts/` is excluded deliberately: the ops probes pin a version ON
      // PURPOSE (e.g. reproducing a v24-only behaviour). Product code may not.
      const offenders = sourceFiles()
        .filter((f) => !f.startsWith(join(REPO_ROOT, 'scripts')))
        .filter((f) => !f.endsWith('graph-api.ts'))
        .filter((f) => !f.includes('.test.') && !f.endsWith('.spec.ts'))
        .filter((f) =>
          /https:\/\/graph\.(facebook|instagram)\.com\/v\d/.test(
            readFileSync(f, 'utf8')
          )
        )
        .map((f) => f.slice(REPO_ROOT.length + 1));
      expect(offenders).toEqual([]);
    });
  });

  describe('idempotency', () => {
    it('every externally-subscribed provider that carries an event id is on the ledger', () => {
      // Providers we cannot unsubscribe from are the ones that retry at us.
      const external = webhookProviders.filter(
        (p) => providerSubscriptionSource[p] === 'external'
      );
      expect(external).toContain('stripe_connect');
      expect(external).toContain('stripe_billing');

      // Both Stripe routers must go through the shared ledger helper. Meta/
      // WhatsApp have no event id — they dedupe downstream on the message id.
      // The stripe_connect ROUTER is the dispatch module, not the controller —
      // the handler body may only call it and return (Gate 5). The invariant is
      // unchanged: whatever routes the event must take the ledger claim.
      const connect = read(
        'apps/api/src/webhooks/stripe-connect/stripe-connect-dispatch.ts'
      );
      expect(connect).toContain('withWebhookIdempotency');
      expect(connect).toContain("'stripe_connect'");

      const billing = read(
        'packages/features/src/billing/services/handle-stripe-webhook/handle-stripe-webhook.service.ts'
      );
      expect(billing).toContain('claimWebhookEvent');
    });
  });
});
