import type {
  ListSellablesResult,
  Sellable,
  SellableKind,
} from '@borradh-workspace/contracts/ports';
import { z } from 'zod';
import { createCatalogPort } from '../../ports/catalog.adapter.js';
import { defineTool } from '../../tool-factory/index.js';

const listSellablesInputSchema = z.object({
  kinds: z
    .array(z.enum(['service', 'package', 'membership']))
    .optional()
    .describe(
      'Restrict to certain kinds. Omit to see everything the business sells ' +
        '— which is almost always what you want before recommending anything.'
    ),
  includeInactive: z
    .boolean()
    .optional()
    .describe(
      'Include items that are switched off. Default false. Never pitch an ' +
        'inactive item — it is not on sale.'
    ),
});

interface ListSellablesOutput {
  summary: string;
  sellables?: Sellable[];
  /** Sources that could NOT be read. Present means the list is incomplete. */
  unchecked?: string[];
  error?: string;
}

const SOURCE_LABEL: Record<string, string> = {
  services: 'services',
  packages: 'packages',
  memberships: 'membership plans',
};

function toOutput(result: ListSellablesResult): ListSellablesOutput {
  if (result.status === 'blocked') {
    return {
      summary: "I couldn't read the price list.",
      error: result.reason.message,
    };
  }

  const counts = result.sellables.reduce<Record<SellableKind, number>>(
    (acc, s) => {
      acc[s.kind] += 1;
      return acc;
    },
    { service: 0, package: 0, membership: 0 }
  );
  const parts = [
    `${counts.service} service(s)`,
    `${counts.package} package(s)`,
    `${counts.membership} membership plan(s)`,
  ];

  if (result.status === 'read') {
    return {
      summary: `Everything on sale: ${parts.join(', ')}.`,
      sellables: result.sellables,
    };
  }

  // NEVER phrased as a complete price list. An unread source is a shelf we did
  // not look at, and presenting the rest as "everything they sell" is the
  // failure this port exists to prevent — the sale is lost silently.
  const unchecked = result.unread.map((s) => SOURCE_LABEL[s] ?? s);
  return {
    summary: `Partial price list — ${parts.join(', ')}. I could not read ${unchecked.join(' or ')}, so this is not everything they sell and you must not present it as such.`,
    sellables: result.sellables,
    unchecked,
  };
}

/**
 * `packages_listSellables` — everything the business sells, in one comparable
 * list.
 *
 * The gap this closes, found by Gate 6: Claire actively sells
 * (`offers_suggestIntroOffer`, `claire_publishOffer`, `context_listServices`)
 * but could see only ONE of the three things an org puts on sale. Packages and
 * membership plans were invisible, so she would recommend a single treatment to
 * someone who would have bought the course of six — under-selling every time,
 * and never knowing, because the better product did not exist as far as she
 * could see.
 *
 * PRICING IS NOT ONE NUMBER. A service, a package and a membership are charged
 * for in three incompatible ways, so `price` is a discriminated union and not a
 * scalar: quoting a €60/month plan as "€60" is a misquote the business has to
 * honour or retract. Amounts are integer CENTS throughout and every such field
 * says so in its name.
 *
 * Read-only, so no confirmation. The honesty lives in the port: a source that
 * could not be read comes back in `unread`, and this tool refuses to present an
 * incomplete catalogue as a complete price list.
 */
export const listSellablesTool = defineTool<
  z.infer<typeof listSellablesInputSchema>,
  ListSellablesOutput
>({
  feature: 'packages',
  action: 'listSellables',
  description:
    'List EVERYTHING the business sells — services, packages (bundles of ' +
    'several services sold as one item) and membership plans — in one ' +
    'comparable list. Use this before recommending or quoting anything, so ' +
    'you do not offer a single treatment when a package or membership is the ' +
    'better sale. Prices are integer CENTS and each carries its own pricing ' +
    'model: one_off, from (a floor — say "from"), free, on_consultation (no ' +
    'amount exists), bundle (one payment for itemCount sessions), ' +
    'prepaid_term (one payment covering a term) and recurring (charged again ' +
    'EVERY period — always say the period). Read-only.',
  inputSchema: listSellablesInputSchema,
  destructive: false,
  // The price list is what a receptionist quotes over the phone all day, and
  // every underlying route is AuthGuard-only with no @RequireRole — so this
  // matches them. It reports what is on sale and for how much; no customer
  // data, no balances, no revenue.
  policy: 'member',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Reading the price list' },
  // `organization-services` is already on the base whitelist (context_
  // listServices reads it); only the two new reads are added here.
  additionalAllowedPaths: [/^packages$/, /^membership-plans$/],
  execute: async (input, ctx) => {
    // Composed over the tool-bound `ctx.apiFetch`, NOT `ctx.ports`. This is
    // permanent until the composition root changes, not a pending swap:
    // `buildAssistantPorts` is handed the BASE `apiFetch` (tool-context.ts),
    // and none of this tool's paths is on the base whitelist — so the shared
    // port would fail the path check on every call. `additionalAllowedPaths`
    // applies only to `ctx.apiFetch`, inside a wrapped execute.
    //
    // `update-ad.tool.ts` and `explain-availability.tool.ts` carry the same
    // workaround for the same reason. See ports/index.ts for the durable fix.
    const catalog = createCatalogPort({ apiFetch: ctx.apiFetch });
    const result = await catalog.listSellables(input);

    if (result.status === 'blocked' && result.reason.kind === 'server_error') {
      ctx.reportIssue('Failed to read the sellables catalogue', {
        extra: { reason: result.reason },
      });
    }

    return { data: toOutput(result) };
  },
});
