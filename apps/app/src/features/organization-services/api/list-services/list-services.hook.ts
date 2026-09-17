import { apiClient } from '@borradh-workspace/api-client';
import type { ListServicesResponse } from '@borradh-workspace/api-client/types';
import { listServicesResponseSchema } from '@borradh-workspace/contracts';
import {
  keepPreviousData,
  queryOptions,
  useQuery,
} from '@tanstack/react-query';

interface ListServicesParams {
  /**
   * Filter by active state. Defaults to `true` so archived services
   * (isActive=false) are hidden by default. Pass `undefined` to fetch
   * both active and archived.
   */
  isActive?: boolean;
  category?: string;
  /**
   * Page size. OMIT THIS unless you genuinely want one page — when it is
   * absent the hook walks every page and returns the whole catalogue. See
   * the pagination note below.
   */
  limit?: number;
  offset?: number;
}

/** The endpoint's public contract caps `limit` at 100 (`list-services.schema.ts`). */
const MAX_PAGE_SIZE = 100;

/**
 * Backstop on the page walk, so a server that never stops advancing `offset`
 * cannot spin forever. 50 pages × 100 = 5,000 services, far beyond any real
 * catalogue (the largest in production is under 200).
 */
const MAX_PAGES = 50;

/**
 * WHY THIS PAGINATES BY DEFAULT
 * -----------------------------
 * `GET organization-services` defaults to `limit: 10` server-side. Every
 * caller that omitted a limit — the POS catalog picker, the batch dialog, the
 * duplicate-name check in the service form, the practitioner services panel —
 * was silently reading the first TEN services and treating that as the whole
 * catalogue. For a clinic with 40 services the other 30 simply did not exist:
 * unpickable, unselectable, and (in the duplicate check) invisible to the
 * validation that is supposed to see them.
 *
 * Truncation here is never the caller's intent. A list of services is a
 * catalogue, not a feed — nothing in this app paginates one in the UI. So an
 * absent `limit` now means "all of it": the query walks pages of 100 until the
 * server stops returning a full page. Passing an explicit `limit` keeps the
 * old single-request behaviour for the few callers that want one page.
 *
 * This is the same failure PR #729 fixed for Claire's catalogue reader; the
 * frontend had it in twenty-odd places.
 */
export const listServicesQueryOptions = (params: ListServicesParams = {}) => {
  // Default to active-only unless caller explicitly opts out.
  const isActive = 'isActive' in params ? params.isActive : true;

  const buildQuery = (limit?: number, offset?: number) => {
    const searchParams = new URLSearchParams();
    if (isActive !== undefined) {
      searchParams.set('isActive', String(isActive));
    }
    if (params.category) {
      searchParams.set('category', params.category);
    }
    if (limit != null) {
      searchParams.set('limit', String(limit));
    }
    if (offset != null) {
      searchParams.set('offset', String(offset));
    }
    const qs = searchParams.toString();
    return `organization-services${qs ? `?${qs}` : ''}`;
  };

  const fetchPage = (limit?: number, offset?: number) =>
    apiClient.get<ListServicesResponse>(buildQuery(limit, offset), {
      schema: listServicesResponseSchema,
    });

  // An explicit limit means the caller asked for exactly one page.
  const isSinglePage = params.limit != null;

  return queryOptions({
    queryKey: ['organization-services', 'list', params],
    queryFn: async () => {
      if (isSinglePage) {
        return fetchPage(params.limit, params.offset);
      }

      const first = await fetchPage(MAX_PAGE_SIZE, params.offset ?? 0);
      const items = [...first.items];

      // `total` is computed unpaginated server-side, so it is the honest size
      // of the result set and tells us when to stop. The full-page check is
      // the belt-and-braces guard for a server that reports it wrong.
      for (let page = 1; page < MAX_PAGES; page++) {
        if (items.length >= first.total) break;
        const offset = (params.offset ?? 0) + page * MAX_PAGE_SIZE;
        const next = await fetchPage(MAX_PAGE_SIZE, offset);
        if (next.items.length === 0) break;
        items.push(...next.items);
        if (next.items.length < MAX_PAGE_SIZE) break;
      }

      return { ...first, items, limit: items.length };
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
    placeholderData: keepPreviousData,
  });
};

export const useListServices = (params: ListServicesParams = {}) => {
  const query = useQuery(listServicesQueryOptions(params));
  return {
    services: query.data?.items ?? [],
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    refetch: query.refetch,
  };
};
