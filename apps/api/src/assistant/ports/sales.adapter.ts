import {
  paymentListResponseSchema,
  saleDailySummarySchema,
} from '@borradh-workspace/contracts';
import type {
  DepositTakings,
  GetTakingsInput,
  GetTakingsResult,
  MoneyAmount,
  PosTakings,
  SalesPort,
  TakingsGap,
  TakingsWindow,
  TenderTotal,
} from '@borradh-workspace/contracts/ports';
import { salePaymentMethodLabels } from '@borradh-workspace/labels';
import { ApiFetchError, type ApiFetchFn } from '../tool-factory/api-fetch.js';

export interface SalesPortDeps {
  apiFetch: ApiFetchFn;
}

/**
 * One `GET /sales/daily-summary` per day, so the fan-out has to be bounded.
 * A month is the longest period an owner asks about in one breath; anything
 * wider is a report, not a question.
 */
const MAX_WINDOW_DAYS = 31;

/**
 * `GET /payments` has no date filter and sorts by `createdAt`, so completeness
 * over a window can only be PROVEN by reading every row. This is the budget
 * for that proof; beyond it the channel is reported unread rather than
 * silently truncated.
 */
const DEPOSIT_PAGE_SIZE = 100;
const DEPOSIT_MAX_PAGES = 5;

/**
 * A 4xx is the API stating a reason; anything else is the server breaking.
 * Only the fault side may reach Sentry — collapsing the two is what made
 * ordinary "no, because…" answers page someone.
 */
function isServerFault(error: unknown): boolean {
  return !(
    error instanceof ApiFetchError &&
    error.status >= 400 &&
    error.status < 500
  );
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : 'Unknown error';

const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

/** Every YYYY-MM-DD in [from, to] inclusive. */
function datesInWindow(from: string, to: string): string[] {
  const out: string[] = [];
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  for (let d = start; d <= end; d = new Date(d.getTime() + 86_400_000)) {
    out.push(isoDate(d));
  }
  return out;
}

/**
 * Render an integer-cents amount with its currency.
 *
 * Every money value leaving this adapter goes through here. A bare `1240` is
 * read by a model as "€1,240" about as often as "€12.40", and that is a
 * hundredfold error in a figure someone reconciles a till against.
 */
function money(amountCents: number, currency: string): MoneyAmount {
  const code = currency.trim().toUpperCase();
  let formatted: string;
  if (code.length !== 3) {
    // No usable currency (no read day told us one). Say so rather than pick.
    formatted = `${(amountCents / 100).toFixed(2)} (currency unknown)`;
  } else {
    try {
      formatted = new Intl.NumberFormat('en-IE', {
        style: 'currency',
        currency: code,
      }).format(amountCents / 100);
    } catch {
      formatted = `${code} ${(amountCents / 100).toFixed(2)}`;
    }
  }
  return { amountCents, currency, formatted };
}

const methodLabel = (method: string): string =>
  (salePaymentMethodLabels as Record<string, string | undefined>)[method] ??
  method;

const qs = (params: Record<string, string | undefined>): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  return sp.toString();
};

/** Running POS totals, folded across the per-day summaries. */
interface PosAccumulator {
  datesRead: string[];
  saleCount: number;
  salesTotalCents: number;
  tipCents: number;
  byMethod: Map<string, { collectedCents: number; refundedCents: number }>;
  currencies: Set<string>;
}

/**
 * Sales / takings port — see `packages/contracts/src/ports/sales.port.ts` for
 * why a takings figure composed from N day-reads and two independent money
 * channels must distinguish "this is the total" from "this is at least the
 * total".
 *
 * Every read is PARSED against its contract schema rather than asserted. A
 * projection that drifts fails loudly here instead of yielding `undefined`
 * fields that arithmetic quietly turns into a smaller number.
 */
export function createSalesPort(deps: SalesPortDeps): SalesPort {
  const { apiFetch } = deps;

  return {
    async getTakings(input: GetTakingsInput): Promise<GetTakingsResult> {
      const { from, to, locationId } = input;

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(to)
      ) {
        return {
          status: 'blocked',
          reason: {
            kind: 'invalid_window',
            message: 'from and to must be YYYY-MM-DD dates.',
          },
        };
      }
      if (to < from) {
        return {
          status: 'blocked',
          reason: {
            kind: 'invalid_window',
            message: `to (${to}) is before from (${from}).`,
          },
        };
      }

      const windowDates = datesInWindow(from, to);
      if (windowDates.length > MAX_WINDOW_DAYS) {
        return {
          status: 'blocked',
          reason: {
            kind: 'window_too_wide',
            message: `That range is ${windowDates.length} days; ${MAX_WINDOW_DAYS} is the most that can be totalled in one go.`,
            maxDays: MAX_WINDOW_DAYS,
          },
        };
      }

      const window: TakingsWindow = {
        from,
        to,
        locationId: locationId ?? null,
      };

      const gaps: TakingsGap[] = [];
      let firstFault: string | undefined;

      // ---- POS: one summary per day ------------------------------------
      // The summary is the authoritative POS figure. It is computed over
      // `completedAt` with `status = 'completed'` and is NOT paginated, unlike
      // `GET /sales` whose 200-row page cap would silently under-report a busy
      // day if the pages were summed instead.
      const pos: PosAccumulator = {
        datesRead: [],
        saleCount: 0,
        salesTotalCents: 0,
        tipCents: 0,
        byMethod: new Map(),
        currencies: new Set(),
      };
      const failedDates: string[] = [];
      let firstDateFailure: string | undefined;

      for (const date of windowDates) {
        try {
          const summary = await apiFetch(
            `sales/daily-summary?${qs({ date, locationId })}`,
            { schema: saleDailySummarySchema }
          );

          pos.datesRead.push(date);
          pos.saleCount += summary.saleCount;
          pos.salesTotalCents += summary.totalCents;
          pos.tipCents += summary.tipCents;
          if (summary.currency) pos.currencies.add(summary.currency);

          // `methodRows` carries collected AND refunded; `byMethod` carries
          // only collected. Walk the union so a method present in one and not
          // the other still lands in the breakdown.
          const methods = new Set([
            ...Object.keys(summary.byMethod),
            ...Object.keys(summary.methodRows),
          ]);
          for (const method of methods) {
            const row = pos.byMethod.get(method) ?? {
              collectedCents: 0,
              refundedCents: 0,
            };
            const detailed = summary.methodRows[method];
            row.collectedCents +=
              detailed?.collectedCents ?? summary.byMethod[method] ?? 0;
            row.refundedCents += detailed?.refundsCents ?? 0;
            pos.byMethod.set(method, row);
          }
        } catch (error) {
          failedDates.push(date);
          if (isServerFault(error)) firstFault ??= messageOf(error);
          firstDateFailure ??= messageOf(error);
        }
      }

      // Two currencies cannot be added. Producing one integer from them is a
      // confident wrong number no consumer can detect, so refuse outright.
      if (pos.currencies.size > 1) {
        return {
          status: 'blocked',
          reason: {
            kind: 'mixed_currency',
            message:
              'Sales in that range are recorded in more than one currency, so they cannot be added into a single total.',
            currencies: [...pos.currencies].sort(),
          },
        };
      }

      if (failedDates.length > 0) {
        gaps.push({
          channel: 'pos',
          dates: failedDates,
          reason:
            firstDateFailure ??
            'The daily totals for these dates would not load.',
        });
      }

      const posCurrency = [...pos.currencies][0] ?? '';

      // ---- Deposits: a separate money channel ---------------------------
      // `payment` (Stripe deposit / checkout links) is a different table from
      // `sale_payment` (POS tenders) and never appears in the daily summary.
      // Leaving it out of "takings" is precisely the under-report this port
      // exists to prevent, so it is read as its own channel.
      let deposits: DepositTakings | null = null;

      if (locationId) {
        // Deposit rows carry no location, so a location-scoped question cannot
        // include them. Reported as missing, never as zero.
        gaps.push({
          channel: 'deposits',
          reason:
            'Deposit and payment-link takings are not recorded against a location, so they could not be included in a per-location total.',
        });
      } else {
        try {
          const rows: {
            paidAt: string | null;
            amountCents: number;
            currency: string;
          }[] = [];
          let total = Number.POSITIVE_INFINITY;
          let read = 0;

          for (let page = 0; page < DEPOSIT_MAX_PAGES; page++) {
            const res = await apiFetch(
              `payments?${qs({
                limit: String(DEPOSIT_PAGE_SIZE),
                offset: String(page * DEPOSIT_PAGE_SIZE),
              })}`,
              { schema: paymentListResponseSchema }
            );
            total = res.total;
            read += res.items.length;
            rows.push(...res.items);
            if (res.items.length < DEPOSIT_PAGE_SIZE || read >= res.total) {
              break;
            }
          }

          if (read < total) {
            // Rows are ordered by `createdAt` while what matters is `paidAt`,
            // so an unread page can hold a deposit paid inside the window. The
            // partial sum would be a floor presented as a total.
            gaps.push({
              channel: 'deposits',
              reason: `There are ${total} payment records and only the most recent ${read} could be checked, so deposit takings for this range cannot be totalled with confidence.`,
            });
          } else {
            const inWindow = rows.filter((p) => {
              if (!p.paidAt) return false;
              const day = p.paidAt.slice(0, 10);
              return day >= from && day <= to;
            });

            // A deposit paid in a currency the POS figure is not in cannot be
            // added to it. Count it as a gap rather than distorting the total.
            const wrongCurrency = posCurrency
              ? inWindow.filter(
                  (p) => p.currency.toLowerCase() !== posCurrency.toLowerCase()
                )
              : [];
            const summable = inWindow.filter((p) => !wrongCurrency.includes(p));

            if (wrongCurrency.length > 0) {
              gaps.push({
                channel: 'deposits',
                reason: `${wrongCurrency.length} deposit(s) in this range are in a different currency to the till takings and were left out of the total.`,
              });
            }

            deposits = {
              count: summable.length,
              paid: money(
                summable.reduce((sum, p) => sum + p.amountCents, 0),
                posCurrency || (summable[0]?.currency ?? '')
              ),
            };
          }
        } catch (error) {
          if (isServerFault(error)) firstFault ??= messageOf(error);
          gaps.push({ channel: 'deposits', reason: messageOf(error) });
        }
      }

      // Nothing at all was learned. Distinct from a partial read, which has
      // findings.
      if (pos.datesRead.length === 0 && deposits === null) {
        return {
          status: 'blocked',
          reason: firstFault
            ? { kind: 'server_error', message: firstFault }
            : {
                kind: 'other',
                message: 'No takings figures could be read for that range.',
              },
        };
      }

      const byTender: TenderTotal[] = [...pos.byMethod.entries()]
        .map(([method, row]) => ({
          method,
          label: methodLabel(method),
          collected: money(row.collectedCents, posCurrency),
          refunded: money(row.refundedCents, posCurrency),
        }))
        .sort((a, b) => b.collected.amountCents - a.collected.amountCents);

      const posTakings: PosTakings = {
        datesRead: pos.datesRead,
        saleCount: pos.saleCount,
        salesTotal: money(pos.salesTotalCents, posCurrency),
        tips: money(pos.tipCents, posCurrency),
        collected: money(
          byTender.reduce((sum, t) => sum + t.collected.amountCents, 0),
          posCurrency
        ),
        refunded: money(
          byTender.reduce((sum, t) => sum + t.refunded.amountCents, 0),
          posCurrency
        ),
        byTender,
      };

      if (gaps.length > 0) {
        // The tuple type is what makes this member impossible to construct
        // without naming what is missing; the check is for the compiler's
        // benefit, and is unreachable given `gaps.length > 0`.
        const [head, ...rest] = gaps;
        if (!head) {
          return {
            status: 'blocked',
            reason: { kind: 'other', message: 'Unreachable: empty gap list.' },
          };
        }
        return {
          status: 'partially_read',
          window,
          pos: posTakings,
          deposits,
          unread: [head, ...rest],
        };
      }

      // `deposits` is non-null here: the only paths that leave it null also
      // push a gap, which the branch above returned on.
      return {
        status: 'read',
        window,
        pos: posTakings,
        deposits: deposits ?? { count: 0, paid: money(0, posCurrency) },
      };
    },
  };
}
