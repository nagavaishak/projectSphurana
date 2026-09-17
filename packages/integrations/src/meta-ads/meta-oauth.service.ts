import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import { logError } from '@borradh-workspace/observability';
import { GRAPH_API_BASE, GRAPH_API_VERSION } from '../shared/graph-api.js';
import {
  extractMetaErrorContext,
  parseMetaErrorResponse,
} from '../shared/meta-api-error.js';
import {
  type OAuthProxyConfig,
  getOAuthProxyConfig,
  signProxyState,
} from '../shared/oauth-proxy.js';
import { metaPageSubscribedFields } from '../webhooks/index.js';
import type {
  MetaAdAccountInfo,
  MetaAssignedAdAccount,
  MetaAssignedPage,
  MetaAssignedWhatsAppAccount,
  MetaBusinessInfo,
  MetaLongLivedTokenResponse,
  MetaOAuthTokenResponse,
  MetaPageInfo,
  MetaTokenDescription,
  MetaUserInfo,
} from './meta-ads.types.js';

const PROXY_PROVIDER = 'meta';
const DEFAULT_CALLBACK_PATH = '/integrations/meta-ads/callback';

/**
 * Service for handling Meta OAuth flow
 * Handles token exchange, ad account fetching, and page selection
 */
export class MetaOAuthService {
  private appId: string;
  private appSecret: string;
  private redirectUri: string;
  private proxyConfig: OAuthProxyConfig | null;
  private callbackPath: string;

  constructor(config?: {
    appId?: string;
    appSecret?: string;
    redirectUri?: string;
    callbackPath?: string;
  }) {
    this.appId = config?.appId || process.env.META_APP_ID || '';
    this.appSecret = config?.appSecret || process.env.META_APP_SECRET || '';
    this.callbackPath = config?.callbackPath || DEFAULT_CALLBACK_PATH;

    // When the OAuth proxy is configured, swap our redirect_uri for the
    // proxy's URL. The proxy then forwards back to `${origin}${callbackPath}`
    // — the existing /integrations/meta-ads/callback handler — using the
    // originating service's URL embedded in the wrapped state.
    this.proxyConfig = getOAuthProxyConfig();
    if (this.proxyConfig) {
      this.redirectUri = `${this.proxyConfig.baseUrl}/oauth/${PROXY_PROVIDER}/callback`;
    } else {
      this.redirectUri =
        config?.redirectUri || process.env.META_OAUTH_REDIRECT_URI || '';
    }

    if (!this.appId || !this.appSecret) {
      console.warn(
        'MetaOAuthService: Missing META_APP_ID or META_APP_SECRET environment variables'
      );
    }
  }

  private maybeWrapState(state: string | undefined): string | undefined {
    if (!state || !this.proxyConfig) return state;
    return (
      signProxyState(
        { callbackPath: this.callbackPath, inner: state },
        this.proxyConfig
      ) ?? state
    );
  }

  /**
   * Follow Graph API cursor pagination.
   *
   * Meta list endpoints page at ~25 records and return the URL for the next
   * page in `paging.next` (a fully-formed URL that already carries the access
   * token + cursor). Reading only the first response silently truncates every
   * asset list to the first page — the root of the "missing ad accounts / pages"
   * bug. Each caller keeps its own first-page fetch + error handling (per-
   * business permission errors must still degrade to []); this helper only
   * walks the remaining pages, returning ALL additional raw rows.
   *
   * A pagination failure on a LATER page never discards the rows already
   * collected — it logs and stops. Capped at MAX_PAGES to avoid an unbounded
   * loop if Meta ever returns a self-referential cursor, AND at BUDGET_MS of
   * wall clock: this runs inside the OAuth callback, where 20 sequential pages
   * at a 15s timeout each would turn "connect your account" into a
   * multi-minute spinner. Whichever cap trips first, we keep what we have.
   */
  private async fetchRemainingPages<T>(
    firstNextUrl: string | undefined,
    label: string
  ): Promise<T[]> {
    const MAX_PAGES = 20;
    /** Wall-clock budget for the WHOLE walk, not per page. */
    const BUDGET_MS = 20_000;
    const startedAt = Date.now();
    const items: T[] = [];
    let next = firstNextUrl;
    let page = 0;
    let outOfBudget = false;

    while (next && page < MAX_PAGES) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= BUDGET_MS) {
        outOfBudget = true;
        logError(
          'metaOAuth.fetchRemainingPages',
          new Error('pagination stopped at wall-clock budget'),
          {
            feature: 'integrations',
            extra: { label, page, elapsed, budgetMs: BUDGET_MS },
          }
        );
        break;
      }
      page++;

      // SSRF defense-in-depth: only follow paging cursors that point at a
      // Facebook Graph host. A tampered/malformed `next` URL stops pagination
      // rather than being fetched. `new URL()` THROWS on a non-absolute or
      // garbled cursor, so parse inside the guard — an unparseable cursor must
      // log-and-stop like every other pagination failure, not blow up the
      // caller's whole asset fetch (no caller wraps this in try/catch).
      let host: string;
      try {
        host = new URL(next).hostname;
      } catch {
        // Deliberately DISCARD the thrown TypeError: Node attaches the raw
        // offending string to it as `.input`, and a Graph `paging.next` carries
        // the access token in its query string. Any downstream serializer that
        // walks arbitrary error properties (Sentry's ExtraErrorData, a JSON
        // dump of the error) would then publish a live token to the logs. Log a
        // clean Error of our own instead — the label and page number below are
        // all the diagnostic context this needs.
        logError(
          'metaOAuth.fetchRemainingPages',
          new Error('unparseable paging cursor'),
          { feature: 'integrations', extra: { label, page } }
        );
        break;
      }
      if (host !== 'graph.facebook.com' && !host.endsWith('.facebook.com')) {
        logError(
          'metaOAuth.fetchRemainingPages',
          new Error('refusing non-Graph paging host'),
          { feature: 'integrations', extra: { host, label, page } }
        );
        break;
      }

      let response: Response;
      try {
        response = await fetchWithRetry(next, { timeoutMs: 15000 });
      } catch (error) {
        logError(`${label}.pagination`, error, {
          feature: 'integrations',
          extra: { page },
        });
        break;
      }

      if (!response.ok) {
        const error = await parseMetaErrorResponse(
          response,
          `Failed to fetch page ${page} for ${label}`
        );
        logError(`${label}.pagination`, error, {
          feature: 'integrations',
          extra: { page, ...extractMetaErrorContext(error) },
        });
        break;
      }

      const data = (await response.json()) as {
        data?: T[];
        paging?: { next?: string };
      };
      if (data.data?.length) items.push(...data.data);
      next = data.paging?.next;
    }

    // Only a cursor still pending AFTER exhausting the page budget is a
    // truncation. Bailing out early on a bad host/cursor/HTTP error also leaves
    // `next` set, but that failure has already been logged — reporting it a
    // second time as "truncated at page cap" is a false signal.
    if (next && page >= MAX_PAGES && !outOfBudget) {
      logError(
        'metaOAuth.fetchRemainingPages',
        new Error('pagination truncated at page cap'),
        { feature: 'integrations', extra: { label, maxPages: MAX_PAGES } }
      );
    }

    return items;
  }

  /**
   * Generate the Facebook OAuth authorization URL
   * @param state Optional state parameter for CSRF protection
   * @returns The OAuth URL to redirect users to
   */
  getAuthorizationUrl(state?: string): string {
    const scopes = [
      // Account & business assets
      'public_profile',
      'email',
      'pages_show_list',
      'business_management',
      'pages_manage_metadata',
      // Facebook content publishing
      'pages_read_engagement',
      'pages_manage_posts',
      // Messenger chatbot
      'pages_messaging',
      // Advertising
      'ads_management',
      'ads_read',
      'pages_manage_ads',
      // Lead generation
      'leads_retrieval',
    ].join(',');

    const wrappedState = this.maybeWrapState(state);

    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      scope: scopes,
      response_type: 'code',
      auth_type: 'rerequest',
      ...(wrappedState && { state: wrappedState }),
    });

    return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   * @param code The authorization code from OAuth callback
   * @returns Access token response
   */
  async exchangeCodeForToken(code: string): Promise<MetaOAuthTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
      code,
    });

    const response = await fetchWithTimeout(
      `${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      throw await parseMetaErrorResponse(response, 'Failed to exchange code');
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Exchange a Facebook Login for Business (FLFB) popup code for the final
   * access token.
   *
   * Unlike the classic flow this is redirect-less — the FB JS SDK popup
   * returns the code in-page, so no `redirect_uri` is sent (it must NOT be,
   * or Meta rejects the exchange). It also needs no `fb_exchange_token`
   * step: when the FLFB config is configured with a System-user access
   * token + Never expiration, this single call returns the non-expiring
   * business (system-user) token directly. `expiresIn` is 0/undefined for a
   * never-expiring token — callers should treat that as "no expiry".
   */
  async exchangeFlfbCodeForToken(
    code: string
  ): Promise<MetaOAuthTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      code,
    });

    const response = await fetchWithTimeout(
      `${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      throw await parseMetaErrorResponse(
        response,
        'Failed to exchange FLFB code'
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type?: string;
      expires_in?: number;
    };
    return {
      accessToken: data.access_token,
      tokenType: data.token_type ?? 'bearer',
      expiresIn: data.expires_in,
    };
  }

  /**
   * Exchange an FLFB code that came back through a REDIRECT, not the popup.
   *
   * Identical to `exchangeFlfbCodeForToken` except that `redirect_uri` is
   * REQUIRED here and must byte-match the one used to build the dialog URL —
   * the popup omits it because there was no redirect, and sending it there is
   * rejected. Getting this backwards produces the same opaque
   * "redirect_uri isn't valid" from Meta in both directions.
   *
   * The token type depends entirely on the FLFB CONFIGURATION: only a config
   * set to issue a System-user token with Never expiration returns a
   * non-expiring business token from this single call. A config left on a User
   * access token returns a ~60-day user token that looks fine today, so
   * callers must check `expiresIn` rather than assume.
   */
  async exchangeFlfbRedirectCodeForToken(
    code: string,
    redirectUri: string
  ): Promise<MetaOAuthTokenResponse> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: redirectUri,
      code,
    });

    const response = await fetchWithTimeout(
      `${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      throw await parseMetaErrorResponse(
        response,
        'Failed to exchange FLFB redirect code'
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type?: string;
      expires_in?: number;
    };
    return {
      accessToken: data.access_token,
      tokenType: data.token_type ?? 'bearer',
      expiresIn: data.expires_in,
    };
  }

  /**
   * Exchange short-lived token for long-lived token (60 days)
   * @param shortLivedToken The short-lived access token
   * @returns Long-lived token response
   */
  async exchangeForLongLivedToken(
    shortLivedToken: string
  ): Promise<MetaLongLivedTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: shortLivedToken,
    });

    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      throw await parseMetaErrorResponse(
        response,
        'Failed to get long-lived token'
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Refresh a long-lived token before it expires.
   * Uses the same endpoint as exchangeForLongLivedToken — Meta accepts
   * a current long-lived token in place of a short-lived one.
   * @param currentToken The current long-lived access token
   * @returns New long-lived token response
   */
  async refreshLongLivedToken(
    currentToken: string
  ): Promise<MetaLongLivedTokenResponse> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: currentToken,
    });

    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/oauth/access_token?${params.toString()}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      throw await parseMetaErrorResponse(
        response,
        'Failed to refresh long-lived token'
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };
    return {
      accessToken: data.access_token,
      tokenType: data.token_type,
      expiresIn: data.expires_in,
    };
  }

  /**
   * Get the authenticated user's info
   * @param accessToken User access token
   * @returns User info
   */
  async getUserInfo(accessToken: string): Promise<MetaUserInfo> {
    try {
      const response = await fetchWithRetry(
        `${GRAPH_API_BASE}/me?fields=id,name,email,picture.type(large)&access_token=${accessToken}`,
        { timeoutMs: 15000 }
      );

      if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({}))) as {
          error?: {
            message?: string;
            type?: string;
            code?: number;
            error_subcode?: number;
          };
        };
        logError(
          'meta.getUserInfo',
          new Error(`Graph API ${response.status}`),
          {
            feature: 'integrations',
            extra: {
              status: response.status,
              errorType: errorBody?.error?.type,
              errorCode: errorBody?.error?.code,
              errorSubcode: errorBody?.error?.error_subcode,
              errorMessage: errorBody?.error?.message,
            },
          }
        );
        return { id: 'unknown', name: 'Unknown' };
      }

      const data = (await response.json()) as {
        id: string;
        name: string;
        email?: string;
        picture?: { data?: { url?: string } };
      };
      return {
        id: data.id,
        name: data.name,
        email: data.email,
        pictureUrl: data.picture?.data?.url,
      };
    } catch (error) {
      logError('meta.getUserInfo', error, {
        feature: 'integrations',
      });
      return { id: 'unknown', name: 'Unknown' };
    }
  }

  /**
   * Get list of businesses the user manages
   * @param accessToken User access token
   * @returns List of businesses
   */
  async getBusinesses(accessToken: string): Promise<MetaBusinessInfo[]> {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/me/businesses?fields=id,name,profile_picture_uri&access_token=${accessToken}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      throw await parseMetaErrorResponse(response, 'Failed to get businesses');
    }

    type RawBusiness = {
      id: string;
      name: string;
      profile_picture_uri?: string;
    };
    const data = (await response.json()) as {
      data?: RawBusiness[];
      paging?: { next?: string };
    };
    const rows = [
      ...(data.data || []),
      ...(await this.fetchRemainingPages<RawBusiness>(
        data.paging?.next,
        'meta.getBusinesses'
      )),
    ];
    return rows.map((biz) => ({
      id: biz.id,
      name: biz.name,
      profilePictureUri: biz.profile_picture_uri,
    }));
  }

  /**
   * Get ad accounts owned by a specific business
   * @param accessToken User access token
   * @param businessId Business ID
   * @returns List of ad accounts with businessId set
   */
  async getBusinessAdAccounts(
    accessToken: string,
    businessId: string
  ): Promise<MetaAdAccountInfo[]> {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/${businessId}/owned_ad_accounts?fields=id,account_id,name,currency,account_status,business_name,disable_reason,funding_source_details{type}&access_token=${accessToken}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const error = await parseMetaErrorResponse(
        response,
        `Failed to get ad accounts for business ${businessId}`
      );
      // Permission errors per-business are expected — skip this business
      if (error.isPermissionError || error.category === 'not_found') {
        logError('meta.getBusinessAdAccounts', error, {
          feature: 'integrations',
          extra: { businessId, ...extractMetaErrorContext(error) },
        });
        return [];
      }
      throw error;
    }

    type RawAdAccount = {
      id: string;
      account_id: string;
      name: string;
      currency: string;
      account_status: number;
      business_name?: string;
      disable_reason?: number;
      funding_source_details?: { type?: number };
    };
    const data = (await response.json()) as {
      data?: RawAdAccount[];
      paging?: { next?: string };
    };
    const rows = [
      ...(data.data || []),
      ...(await this.fetchRemainingPages<RawAdAccount>(
        data.paging?.next,
        'meta.getBusinessAdAccounts'
      )),
    ];
    return rows.map((account) => ({
      id: account.id,
      accountId: account.account_id,
      name: account.name,
      currency: account.currency,
      accountStatus: account.account_status,
      businessName: account.business_name,
      businessId,
      disableReason: account.disable_reason,
      hasPaymentMethod: account.funding_source_details?.type != null,
    }));
  }

  /**
   * Get pages owned by a specific business
   * @param accessToken User access token
   * @param businessId Business ID
   * @returns List of pages with businessId set
   */
  async getBusinessPages(
    accessToken: string,
    businessId: string
  ): Promise<MetaPageInfo[]> {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/${businessId}/owned_pages?fields=id,name,access_token,category,picture,instagram_business_account{id,name,username,profile_picture_url}&access_token=${accessToken}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const error = await parseMetaErrorResponse(
        response,
        `Failed to get pages for business ${businessId}`
      );
      // Permission errors per-business are expected — skip this business
      if (error.isPermissionError || error.category === 'not_found') {
        logError('meta.getBusinessPages', error, {
          feature: 'integrations',
          extra: { businessId, ...extractMetaErrorContext(error) },
        });
        return [];
      }
      throw error;
    }

    type RawPage = {
      id: string;
      name: string;
      access_token: string;
      category?: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: {
        id: string;
        name: string;
        username: string;
        profile_picture_url?: string;
      };
    };
    const data = (await response.json()) as {
      data?: RawPage[];
      paging?: { next?: string };
    };
    const rows = [
      ...(data.data || []),
      ...(await this.fetchRemainingPages<RawPage>(
        data.paging?.next,
        'meta.getBusinessPages'
      )),
    ];

    return rows.map((page) => {
      const instagramBusinessAccount = page.instagram_business_account
        ? {
            id: page.instagram_business_account.id,
            name: page.instagram_business_account.name,
            username: page.instagram_business_account.username,
            profilePictureUrl:
              page.instagram_business_account.profile_picture_url,
          }
        : undefined;

      return {
        id: page.id,
        name: page.name,
        accessToken: page.access_token,
        category: page.category,
        pictureUrl: page.picture?.data?.url,
        businessId,
        instagramBusinessAccount,
      };
    });
  }

  /**
   * Get list of ad accounts the user has access to (across all businesses)
   * @param accessToken User access token
   * @returns List of ad accounts
   */
  async getAdAccounts(accessToken: string): Promise<MetaAdAccountInfo[]> {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/me/adaccounts?fields=id,account_id,name,currency,account_status,business_name,business{id},disable_reason,funding_source_details{type}&access_token=${accessToken}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      throw await parseMetaErrorResponse(response, 'Failed to get ad accounts');
    }

    type RawAdAccount = {
      id: string;
      account_id: string;
      name: string;
      currency: string;
      account_status: number;
      business_name?: string;
      business?: { id?: string };
      disable_reason?: number;
      funding_source_details?: { type?: number };
    };
    const data = (await response.json()) as {
      data?: RawAdAccount[];
      paging?: { next?: string };
    };
    const rows = [
      ...(data.data || []),
      ...(await this.fetchRemainingPages<RawAdAccount>(
        data.paging?.next,
        'meta.getAdAccounts'
      )),
    ];
    return rows.map((account) => ({
      id: account.id,
      accountId: account.account_id,
      name: account.name,
      currency: account.currency,
      accountStatus: account.account_status,
      businessName: account.business_name,
      // /me/adaccounts doesn't group by business like /owned_ad_accounts does;
      // carry the business id when Graph returns it so the merge in
      // connect-meta-ads can preserve business attribution.
      businessId: account.business?.id,
      disableReason: account.disable_reason,
      hasPaymentMethod: account.funding_source_details?.type != null,
    }));
  }

  /**
   * Get list of Facebook Pages the user manages
   * @param accessToken User access token
   * @returns List of pages with their access tokens
   */
  async getPages(accessToken: string): Promise<MetaPageInfo[]> {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/me/accounts?fields=id,name,access_token,category,picture,instagram_business_account{id,name,username,profile_picture_url}&access_token=${accessToken}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      throw await parseMetaErrorResponse(response, 'Failed to get pages');
    }

    type RawPage = {
      id: string;
      name: string;
      access_token: string;
      category?: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: {
        id: string;
        name: string;
        username: string;
        profile_picture_url?: string;
      };
    };
    const data = (await response.json()) as {
      data?: RawPage[];
      paging?: { next?: string };
    };
    const rows = [
      ...(data.data || []),
      ...(await this.fetchRemainingPages<RawPage>(
        data.paging?.next,
        'meta.getPages'
      )),
    ];

    const pages = rows.map((page) => {
      const instagramBusinessAccount = page.instagram_business_account
        ? {
            id: page.instagram_business_account.id,
            name: page.instagram_business_account.name,
            username: page.instagram_business_account.username,
            profilePictureUrl:
              page.instagram_business_account.profile_picture_url,
          }
        : undefined;

      return {
        id: page.id,
        name: page.name,
        accessToken: page.access_token,
        category: page.category,
        pictureUrl: page.picture?.data?.url,
        instagramBusinessAccount,
      };
    });

    return pages;
  }

  /**
   * Resolve the Instagram Business Account linked to a Facebook Page.
   * Used to populate meta_ads_page.linked_instagram_* so Instagram DMs +
   * publishing can run on the page (FLfB system-user) token. Best-effort:
   * returns null if the page has no linked IG account or the call fails.
   * @param pageId Facebook Page ID
   * @param pageAccessToken Page access token
   */
  async getPageInstagramAccount(
    pageId: string,
    pageAccessToken: string
  ): Promise<{ id: string; name?: string; username?: string } | null> {
    try {
      const response = await fetchWithRetry(
        `${GRAPH_API_BASE}/${pageId}?fields=instagram_business_account{id,name,username}&access_token=${pageAccessToken}`,
        { timeoutMs: 15000 }
      );
      if (!response.ok) return null;
      const data = (await response.json()) as {
        instagram_business_account?: {
          id: string;
          name?: string;
          username?: string;
        };
      };
      const iba = data.instagram_business_account;
      return iba
        ? { id: iba.id, name: iba.name, username: iba.username }
        : null;
    } catch {
      return null;
    }
  }

  /**
   * Validate an access token
   * @param accessToken Token to validate
   * @returns Whether the token is valid
   */
  async validateToken(
    accessToken: string
  ): Promise<{ isValid: boolean; expiresAt?: number; scopes?: string[] }> {
    try {
      const response = await fetchWithRetry(
        `${GRAPH_API_BASE}/debug_token?input_token=${accessToken}&access_token=${this.appId}|${this.appSecret}`,
        { timeoutMs: 15000 }
      );

      if (!response.ok) {
        return { isValid: false };
      }

      const data = (await response.json()) as {
        data?: {
          is_valid: boolean;
          expires_at?: number;
          scopes?: string[];
        };
      };
      const tokenData = data.data;

      return {
        isValid: tokenData?.is_valid ?? false,
        expiresAt: tokenData?.expires_at,
        scopes: tokenData?.scopes,
      };
    } catch {
      return { isValid: false };
    }
  }

  /**
   * One page, with the page access token derived from the caller's token.
   *
   * The discovery step deliberately does NOT carry page access tokens out to
   * the browser, so the linking step re-reads the pages the operator picked.
   * Asking for exactly those ids is also the check that they were reachable —
   * a page that was un-shared between the two steps fails here rather than
   * being written with a stale token.
   */
  async getPage(
    accessToken: string,
    pageId: string
  ): Promise<MetaPageInfo | null> {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/${pageId}?fields=id,name,access_token,category,picture,instagram_business_account{id,name,username,profile_picture_url}&access_token=${accessToken}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const error = await parseMetaErrorResponse(
        response,
        `Failed to get page ${pageId}`
      );
      if (error.isPermissionError || error.category === 'not_found') {
        logError('meta.getPage', error, {
          feature: 'integrations',
          extra: { pageId, ...extractMetaErrorContext(error) },
        });
        return null;
      }
      throw error;
    }

    const page = (await response.json()) as {
      id: string;
      name: string;
      access_token?: string;
      category?: string;
      picture?: { data?: { url?: string } };
      instagram_business_account?: {
        id: string;
        name: string;
        username: string;
        profile_picture_url?: string;
      };
    };

    // No page token means the system user holds no task on the page — it can
    // be seen but not acted through, which is not a connection.
    if (!page.access_token) return null;

    return {
      id: page.id,
      name: page.name,
      accessToken: page.access_token,
      category: page.category,
      pictureUrl: page.picture?.data?.url,
      instagramBusinessAccount: page.instagram_business_account
        ? {
            id: page.instagram_business_account.id,
            name: page.instagram_business_account.name,
            username: page.instagram_business_account.username,
            profilePictureUrl:
              page.instagram_business_account.profile_picture_url,
          }
        : undefined,
    };
  }

  /**
   * Inspect a token and say what it actually IS, not merely whether it works.
   *
   * `validateToken` answers yes/no, which is the wrong shape for the paste
   * flow: an operator who pastes the wrong string needs to know WHICH wrong
   * string it was. The three mistakes that look identical from a boolean are a
   * token minted by a different app, a user token pasted instead of a system
   * user's, and a token that has already expired — and each has a different
   * fix.
   */
  async describeToken(accessToken: string): Promise<MetaTokenDescription> {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/debug_token?input_token=${encodeURIComponent(
        accessToken
      )}&access_token=${this.appId}|${this.appSecret}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const error = await parseMetaErrorResponse(
        response,
        'Failed to inspect token'
      );
      throw error;
    }

    const body = (await response.json()) as {
      data?: {
        app_id?: string;
        type?: string;
        is_valid?: boolean;
        expires_at?: number;
        data_access_expires_at?: number;
        scopes?: string[];
        granular_scopes?: { scope: string; target_ids?: string[] }[];
        error?: { message?: string };
      };
    };
    const data = body.data ?? {};

    return {
      isValid: data.is_valid ?? false,
      appId: data.app_id ?? null,
      // Meta reports a system user's token as type SYSTEM_USER; a person's is
      // USER. The paste flow rejects USER, because a person's token expires
      // and takes the connection down with it when they leave the business.
      type: data.type ?? null,
      // 0 means "never" for system-user tokens, which is the property the
      // whole migration is for. Normalise it to null so callers do not store
      // an expiry of 1970.
      expiresAt:
        data.expires_at && data.expires_at > 0 ? data.expires_at : null,
      scopes: data.scopes ?? [],
      error: data.error?.message ?? null,
    };
  }

  /**
   * The assets a SYSTEM USER has been assigned, read from the system user
   * itself rather than by walking business portfolios.
   *
   * `/me/businesses` is the obvious call and it is the wrong one: for a system
   * user token it comes back EMPTY, so a discovery built on it finds no
   * businesses, filters everything out, and reports "no client has shared
   * anything with us" for a token that can see plenty. The assigned_* edges
   * are also the more truthful question — they list what this system user can
   * actually act through, where a portfolio walk lists what somebody shared
   * with the portfolio, which is a strictly larger and partly unusable set.
   *
   * Each asset carries the business that owns it, which is what lets an
   * operator find one client among all of them.
   */
  async getAssignedPages(accessToken: string): Promise<MetaAssignedPage[]> {
    const rows = await this.readAssigned<{
      id: string;
      name: string;
      category?: string;
      tasks?: string[];
      picture?: { data?: { url?: string } };
      business?: { id: string; name: string };
      instagram_business_account?: {
        id: string;
        name?: string;
        username: string;
        profile_picture_url?: string;
      };
    }>(
      accessToken,
      'assigned_pages',
      'id,name,category,tasks,picture,business{id,name},instagram_business_account{id,name,username,profile_picture_url}'
    );

    return rows.map((page) => ({
      id: page.id,
      name: page.name,
      category: page.category ?? null,
      tasks: page.tasks ?? [],
      pictureUrl: page.picture?.data?.url ?? null,
      businessId: page.business?.id ?? null,
      businessName: page.business?.name ?? null,
      instagram: page.instagram_business_account
        ? {
            id: page.instagram_business_account.id,
            username: page.instagram_business_account.username,
            name:
              page.instagram_business_account.name ??
              page.instagram_business_account.username,
            profilePictureUrl:
              page.instagram_business_account.profile_picture_url ?? null,
          }
        : null,
    }));
  }

  /** Ad accounts assigned to this system user. See `getAssignedPages`. */
  async getAssignedAdAccounts(
    accessToken: string
  ): Promise<MetaAssignedAdAccount[]> {
    const rows = await this.readAssigned<{
      id: string;
      account_id: string;
      name: string;
      currency?: string;
      business?: { id: string; name: string };
    }>(
      accessToken,
      'assigned_ad_accounts',
      'id,account_id,name,currency,business{id,name}'
    );

    return rows.map((account) => ({
      id: account.id,
      accountId: account.account_id,
      name: account.name,
      currency: account.currency ?? null,
      businessId: account.business?.id ?? null,
      businessName: account.business?.name ?? null,
    }));
  }

  /** WhatsApp Business Accounts assigned to this system user. */
  async getAssignedWhatsAppAccounts(
    accessToken: string
  ): Promise<MetaAssignedWhatsAppAccount[]> {
    const rows = await this.readAssigned<{
      id: string;
      name?: string;
      business?: { id: string; name: string };
    }>(
      accessToken,
      'assigned_whatsapp_business_accounts',
      'id,name,business{id,name}'
    );

    return rows.map((waba) => ({
      id: waba.id,
      name: waba.name ?? null,
      businessId: waba.business?.id ?? null,
      businessName: waba.business?.name ?? null,
    }));
  }

  /**
   * What a client actually GRANTED us on each Page they shared.
   *
   * A partner can only sub-delegate tasks it was granted, so this is the
   * ceiling on what any system user can ever be given. It is the only way to
   * know, before assigning anything, that a Page cannot carry lead access —
   * `assigned_pages.tasks` answers the same question but only for Pages that
   * are already assigned, which is too late to be a warning.
   *
   * Portfolio tasks are spelled `PROFILE_PLUS_MANAGE_LEADS` where the assigned
   * edge says `MANAGE_LEADS`; callers should match loosely.
   */
  async getBusinessPagePermissions(
    accessToken: string,
    businessId: string,
    edge: 'owned' | 'client'
  ): Promise<
    Array<{ id: string; name: string | null; permittedTasks: string[] }>
  > {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/${businessId}/${edge}_pages?fields=id,name,permitted_tasks&limit=200&access_token=${accessToken}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const error = await parseMetaErrorResponse(
        response,
        `Failed to read ${edge}_pages`
      );
      // Same reasoning as the WhatsApp reader: "none" is a normal shape and
      // must not take the rest of the plan down with it.
      if (error.isPermissionError || error.category === 'not_found') {
        logError('meta.getBusinessPagePermissions', error, {
          feature: 'integrations',
          extra: { businessId, edge, ...extractMetaErrorContext(error) },
        });
        return [];
      }
      throw error;
    }

    type RawPage = { id: string; name?: string; permitted_tasks?: string[] };
    const data = (await response.json()) as {
      data?: RawPage[];
      paging?: { next?: string };
    };
    const rows = [
      ...(data.data || []),
      ...(await this.fetchRemainingPages<RawPage>(
        data.paging?.next,
        `meta.${edge}PagePermissions`
      )),
    ];

    return rows.map((page) => ({
      id: page.id,
      name: page.name ?? null,
      permittedTasks: page.permitted_tasks ?? [],
    }));
  }

  /**
   * WhatsApp Business Accounts on a business portfolio.
   *
   * WhatsApp is the exception to the assigned_* rule: a WABA does NOT appear on
   * `/me/assigned_whatsapp_business_accounts` even when the system user can
   * read it perfectly well by id. They live on the PORTFOLIO —
   * `owned_whatsapp_business_accounts` for numbers we hold, and
   * `client_whatsapp_business_accounts` for numbers a client shared with us —
   * which is why this takes a business id where the other readers do not.
   *
   * Each row carries its owning business so callers can group it beside that
   * client's Page.
   */
  async getBusinessWhatsAppAccounts(
    accessToken: string,
    businessId: string,
    edge: 'owned' | 'client'
  ): Promise<MetaAssignedWhatsAppAccount[]> {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/${businessId}/${edge}_whatsapp_business_accounts?fields=id,name,owner_business_info&access_token=${accessToken}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const error = await parseMetaErrorResponse(
        response,
        `Failed to read ${edge}_whatsapp_business_accounts`
      );
      // No WhatsApp assets, or no WhatsApp task on this portfolio: a normal
      // shape of "none", and it must not take Page discovery down with it.
      if (error.isPermissionError || error.category === 'not_found') {
        logError('meta.getBusinessWhatsAppAccounts', error, {
          feature: 'integrations',
          extra: { businessId, edge, ...extractMetaErrorContext(error) },
        });
        return [];
      }
      throw error;
    }

    type RawWaba = {
      id: string;
      name?: string;
      owner_business_info?: { id?: string; name?: string };
    };
    const data = (await response.json()) as {
      data?: RawWaba[];
      paging?: { next?: string };
    };
    const rows = [
      ...(data.data || []),
      ...(await this.fetchRemainingPages<RawWaba>(
        data.paging?.next,
        `meta.${edge}WhatsAppAccounts`
      )),
    ];

    return rows.map((waba) => ({
      id: waba.id,
      name: waba.name ?? null,
      businessId: waba.owner_business_info?.id ?? null,
      businessName: waba.owner_business_info?.name ?? null,
    }));
  }

  /**
   * One assigned_* edge on `/me`, paged out.
   *
   * A permission error on one edge means the system user holds no task of that
   * kind — a normal shape of "none", not a failed discovery, and it must not
   * take the other two down with it.
   */
  private async readAssigned<T>(
    accessToken: string,
    edge: string,
    fields: string
  ): Promise<T[]> {
    const response = await fetchWithRetry(
      `${GRAPH_API_BASE}/me/${edge}?fields=${fields}&access_token=${accessToken}`,
      { timeoutMs: 15000 }
    );

    if (!response.ok) {
      const error = await parseMetaErrorResponse(
        response,
        `Failed to read ${edge}`
      );
      if (error.isPermissionError || error.category === 'not_found') {
        logError('meta.readAssigned', error, {
          feature: 'integrations',
          extra: { edge, ...extractMetaErrorContext(error) },
        });
        return [];
      }
      throw error;
    }

    const data = (await response.json()) as {
      data?: T[];
      paging?: { next?: string };
    };
    return [
      ...(data.data || []),
      ...(await this.fetchRemainingPages<T>(data.paging?.next, `meta.${edge}`)),
    ];
  }

  /**
   * Subscribe a page to receive webhook events (for lead ads, etc.)
   * @param pageId Page ID
   * @param pageAccessToken Page access token
   * @param fields Fields to subscribe to
   * @returns Success status
   */
  async subscribePageToWebhooks(
    pageId: string,
    pageAccessToken: string,
    fields: readonly string[] = metaPageSubscribedFields
  ): Promise<boolean> {
    const response = await fetchWithTimeout(
      `${GRAPH_API_BASE}/${pageId}/subscribed_apps`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscribed_fields: fields,
          access_token: pageAccessToken,
        }),
        timeoutMs: 15000,
      }
    );

    if (!response.ok) {
      const error = await parseMetaErrorResponse(
        response,
        `Failed to subscribe page ${pageId} to webhooks`
      );
      logError('meta.subscribePageToWebhooks', error, {
        feature: 'integrations',
        extra: { pageId, fields, ...extractMetaErrorContext(error) },
      });
      return false;
    }

    return true;
  }
}
