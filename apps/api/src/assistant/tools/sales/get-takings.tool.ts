import type { GetTakingsResult } from '@borradh-workspace/contracts/ports';
import { z } from 'zod';
import { createSalesPort } from '../../ports/sales.adapter.js';
import { defineTool } from '../../tool-factory/index.js';

const getTakingsInputSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('First date to total, YYYY-MM-DD.'),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe(
      'Last date to total, inclusive, YYYY-MM-DD. Same as `from` for a ' +
        'single day. At most 31 days.'
    ),
  locationId: z
    .string()
    .optional()
    .describe(
      'Total one location only. Omit for the whole business. NOTE: deposit ' +
        'and payment-link takings are not recorded against a location, so ' +
        'supplying this excludes them and the answer will say so. You cannot ' +
        'invent this id — only pass one you read from another tool.'
    ),
});

/**
 * Every money field is a rendered string (`'€1,240.00'`), never a number.
 *
 * The wire figure is integer CENTS; handing the model `1240` invites it to say
 * "€1,240" for twelve euro forty. The cents are still available under
 * `*Cents`-suffixed keys for arithmetic, where the unit is in the name.
 */
interface TenderLine {
  method: string;
  collected: string;
  collectedCents: number;
  refunded?: string;
}

interface GetTakingsOutput {
  summary: string;
  /** True ONLY when every day and every money channel was read. */
  complete?: boolean;
  period?: string;
  currency?: string;
  tillTakings?: string;
  tillTakingsCents?: number;
  tips?: string;
  refunds?: string;
  saleCount?: number;
  byTender?: TenderLine[];
  /** Deposit / payment-link money — a SEPARATE channel from till takings. */
  depositTakings?: string;
  depositCount?: number;
  /** What is missing. Present means the figures are a floor, not a total. */
  notIncluded?: string[];
  error?: string;
}

function toOutput(result: GetTakingsResult): GetTakingsOutput {
  if (result.status === 'blocked') {
    return {
      summary: "I couldn't work out the takings for that period.",
      error: result.reason.message,
    };
  }

  const { window, pos, deposits } = result;
  const complete = result.status === 'read';
  const period =
    window.from === window.to ? window.from : `${window.from} to ${window.to}`;

  const notIncluded =
    result.status === 'partially_read'
      ? result.unread.map((gap) =>
          gap.channel === 'pos'
            ? `Till takings for ${gap.dates.join(', ')} — ${gap.reason}`
            : `Deposits and payment links — ${gap.reason}`
        )
      : undefined;

  // The summary NEVER states a total on a partial read. An unread day or an
  // unread channel means money is missing from the figure, and a takings number
  // that looks authoritative is exactly what gets reconciled against a till and
  // turned into an accusation.
  const summary =
    result.status === 'read'
      ? `Till takings for ${period}: ${pos.collected.formatted} across ${pos.saleCount} completed sale(s)${
          result.deposits.count > 0
            ? `, plus ${result.deposits.paid.formatted} through ${result.deposits.count} deposit/payment link(s).`
            : ', with no deposit or payment-link takings.'
        }`
      : `At least ${pos.collected.formatted} was taken at the till for ${period}, but this is NOT the full figure — ${result.unread.length} thing(s) could not be read, so do not present it as the period's takings.`;

  return {
    summary,
    complete,
    period,
    currency: pos.collected.currency,
    tillTakings: pos.collected.formatted,
    tillTakingsCents: pos.collected.amountCents,
    tips: pos.tips.formatted,
    ...(pos.refunded.amountCents > 0
      ? { refunds: pos.refunded.formatted }
      : {}),
    saleCount: pos.saleCount,
    byTender: pos.byTender.map((t) => ({
      method: t.label,
      collected: t.collected.formatted,
      collectedCents: t.collected.amountCents,
      ...(t.refunded.amountCents > 0 ? { refunded: t.refunded.formatted } : {}),
    })),
    ...(deposits
      ? {
          depositTakings: deposits.paid.formatted,
          depositCount: deposits.count,
        }
      : {}),
    ...(notIncluded ? { notIncluded } : {}),
  };
}

/**
 * `sales_getTakings` — answer "what did we take today?".
 *
 * The gap this closes: sales and payments had 18 endpoints and zero tools, so
 * the single most common revenue question an owner asks had no answer at all.
 *
 * Read-only, so no confirmation. The honesty lives in the port: the figure is
 * assembled from one summary per day plus a separate deposits channel, and any
 * day or channel that could not be read comes back in `unread` — this tool
 * then refuses to phrase the result as a total.
 *
 * WRITES REMAIN OUT OF REACH. Opening, tendering, completing, voiding and
 * refunding a sale each need their own confirmation design and are declared
 * `notExposed` in `coverage.ts`; nothing here moves money.
 */
export const getTakingsTool = defineTool<
  z.infer<typeof getTakingsInputSchema>,
  GetTakingsOutput
>({
  feature: 'sales',
  action: 'getTakings',
  description:
    'Total what the business took over a date range, split by tender (cash, ' +
    'card terminal, QR self-checkout, manual card, gift card), including tips, ' +
    'refunds and deposit/payment-link takings. Use for "what did we take ' +
    'today", "how did last week split between cash and card", or any revenue ' +
    'total. Read-only. If any day or channel could not be read it says so — ' +
    'do not present a partial figure as the period total.',
  inputSchema: getTakingsInputSchema,
  destructive: false,
  // ADMIN, deliberately stricter than the HTTP routes behind it.
  //
  // `destructive: false` is a confirmation gate, not an authorization one, so
  // it says nothing about who may ask. Whole-business revenue is not rota
  // shape: it is the number that judges the business and gets reconciled
  // against a drawer, and a chat surface has no per-row redaction to soften it.
  // `GET /sales/daily-summary` and `GET /payments` are AuthGuard-only with no
  // @RequireRole, so this is TIGHTER than the routes — chosen that way because
  // the policy is a minimum and tightening it later is a breaking change for
  // whoever came to rely on it, whereas relaxing it is not. If the ungated
  // routes are the intended posture, this drops to 'member' in one line.
  policy: 'admin',
  preferredModel: 'sonnet',
  presentation: { statusLabel: 'Totalling takings' },
  additionalAllowedPaths: [
    /^sales\/daily-summary(\?.*)?$/,
    /^payments(\?.*)?$/,
  ],
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
    const port = createSalesPort({ apiFetch: ctx.apiFetch });
    const result = await port.getTakings(input);

    if (result.status === 'blocked' && result.reason.kind === 'server_error') {
      ctx.reportIssue('Failed to read takings', {
        extra: { reason: result.reason },
      });
    }

    return { data: toOutput(result) };
  },
});
