/**
 * Business-owned domains — claim a hostname for a Business Manager and read
 * back its verification state (plan §11, "Domain verification").
 *
 *   POST /v21.0/{business_id}/owned_domains   → claim
 *   GET  /v21.0/{business_id}/owned_domains   → poll
 *
 * WHY THIS MATTERS ENOUGH TO BE ITS OWN MODULE: without a verified domain,
 * Meta will not attribute iOS conversions to the pixel firing on it, and
 * Aggregated Event Measurement cannot be configured for it at all. The pixel
 * is near-useless on that traffic. On a normal customer website this is a
 * support ticket — DNS TXT record, copy-paste, wait — but WE render the page,
 * so we can serve the `<meta name="facebook-domain-verify">` tag ourselves and
 * the customer does nothing. That only pays off if it is automated end to end,
 * which is what this client exists for.
 *
 * It sits beside `meta-capi` rather than inside it because this is a BUSINESS
 * edge, not an ad-account or dataset edge: different id, different permission
 * (`business_management`), and a different failure mode — an unverified
 * Business Manager blocks this API while leaving CAPI perfectly healthy.
 *
 * Conventions follow the other Meta clients here exactly: `GRAPH_API_BASE` for
 * the version, `appsecret_proof` when an app secret is configured,
 * `fetchWithRetry`, and `parseMetaErrorResponse` for error mapping.
 */

import { createHmac } from 'node:crypto';
import { fetchWithRetry } from '@borradh-workspace/http';
import { GRAPH_API_BASE } from '../shared/graph-api.js';
import { parseMetaErrorResponse } from '../shared/meta-api-error.js';
import {
  MetaOwnedDomainError,
  toOwnedDomainError,
} from './meta-domains.errors.js';

export interface MetaOwnedDomainsCredentials {
  accessToken: string;
  /** The Business Manager id that will OWN the domain. */
  businessId: string;
  appSecret?: string;
}

export interface MetaOwnedDomain {
  id: string;
  domain: string;
  /** Meta's own wording: `VERIFIED` / `NOT_VERIFIED` / `PENDING`, or absent. */
  verificationStatus?: string;
  /**
   * The value for `<meta name="facebook-domain-verify" content="…">`.
   *
   * Undefined is a REAL state, not a bug: Meta does not expose the code on
   * every account shape, and the caller must be able to tell "not verified
   * yet" from "we cannot self-serve this one". NEVER log this value.
   */
  verificationToken?: string;
}

export type ClaimDomainOutcome = 'claimed' | 'already_owned';

export interface ClaimDomainResult {
  outcome: ClaimDomainOutcome;
  ownedDomain: MetaOwnedDomain;
}

/**
 * `verification_code` is the field the Graph docs name, but it is not present
 * on every account shape and Meta has shipped more than one spelling. Read all
 * of them, and treat a `meta_tag` HTML blob as a last resort by pulling the
 * `content` attribute out of it.
 */
const readVerificationToken = (
  record: Record<string, unknown>
): string | undefined => {
  for (const key of [
    'verification_code',
    'verification_token',
    'domain_verification_code',
  ]) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }

  const tag = record.meta_tag;
  if (typeof tag === 'string') {
    const match = /content=["']([^"']+)["']/.exec(tag);
    if (match) return match[1];
  }
  return undefined;
};

const toOwnedDomain = (record: Record<string, unknown>): MetaOwnedDomain => ({
  id: String(record.id ?? ''),
  domain: String(record.domain ?? record.domain_name ?? '').toLowerCase(),
  verificationStatus:
    typeof record.verification_status === 'string'
      ? record.verification_status
      : undefined,
  verificationToken: readVerificationToken(record),
});

/** Fields we ASK for, richest first — see `listOwnedDomains` for the fallback. */
const FIELDS_WITH_TOKEN = 'id,domain,verification_status,verification_code';
const FIELDS_CORE = 'id,domain,verification_status';

/** Bounds a pathological account. 10 x 100 domains is far beyond any tenant. */
const MAX_PAGES = 10;

export class MetaOwnedDomainsService {
  private readonly accessToken: string;
  private readonly businessId: string;
  private readonly appSecret?: string;

  constructor(credentials: MetaOwnedDomainsCredentials) {
    this.accessToken = credentials.accessToken;
    this.businessId = credentials.businessId;
    this.appSecret = credentials.appSecret;
  }

  private authParams(): URLSearchParams {
    const params = new URLSearchParams({ access_token: this.accessToken });
    if (this.appSecret) {
      params.set(
        'appsecret_proof',
        createHmac('sha256', this.appSecret)
          .update(this.accessToken)
          .digest('hex')
      );
    }
    return params;
  }

  /**
   * Every domain this business owns.
   *
   * Asks for the verification code first and silently retries with the core
   * field set when Meta rejects it as a nonexisting field. A hard 400 on an
   * optional field would otherwise take out the whole verification path for
   * every tenant on the account shapes that do not expose it.
   */
  async listOwnedDomains(): Promise<MetaOwnedDomain[]> {
    try {
      return await this.listWithFields(FIELDS_WITH_TOKEN);
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (
        /nonexisting field|Unsupported get request|unknown field/i.test(message)
      ) {
        return this.listWithFields(FIELDS_CORE);
      }
      throw toOwnedDomainError(error, 'Failed to list owned domains');
    }
  }

  private async listWithFields(fields: string): Promise<MetaOwnedDomain[]> {
    const params = this.authParams();
    params.set('fields', fields);
    params.set('limit', '100');

    let url = `${GRAPH_API_BASE}/${this.businessId}/owned_domains?${params.toString()}`;
    const out: MetaOwnedDomain[] = [];

    for (let page = 0; page < MAX_PAGES && url; page += 1) {
      const response = await fetchWithRetry(url, { method: 'GET' });
      if (!response.ok) {
        throw await parseMetaErrorResponse(
          response,
          'Failed to list owned domains'
        );
      }

      const json = (await response.json()) as {
        data?: Record<string, unknown>[];
        paging?: { next?: string };
      };
      for (const record of json.data ?? []) out.push(toOwnedDomain(record));

      url = json.paging?.next ?? '';
    }

    return out;
  }

  /** The one domain, or null. Case-insensitive: hostnames are. */
  async getOwnedDomain(domain: string): Promise<MetaOwnedDomain | null> {
    const wanted = domain.trim().toLowerCase();
    const all = await this.listOwnedDomains();
    return all.find((d) => d.domain === wanted) ?? null;
  }

  /**
   * Claim the domain for this business — IDEMPOTENTLY.
   *
   * The poller calls this on a schedule and both trigger points can fire for
   * the same host, so "this business already owns it" is the NORMAL steady
   * state, not an error. The read comes first for exactly that reason: it is
   * the common path, and it is the only way to tell the harmless case (ours
   * already) from the one that needs a human (someone else's).
   *
   * A claim rejected as already-claimed is re-READ before it is called a
   * conflict, because Meta returns the same class of error for both, and
   * because two of our own workers racing must not produce a support ticket.
   */
  async claimDomain(domain: string): Promise<ClaimDomainResult> {
    const wanted = domain.trim().toLowerCase();

    const existing = await this.getOwnedDomain(wanted);
    if (existing) return { outcome: 'already_owned', ownedDomain: existing };

    const params = this.authParams();
    params.set('domain_name', wanted);

    let response: Response;
    try {
      response = await fetchWithRetry(
        `${GRAPH_API_BASE}/${this.businessId}/owned_domains`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
        }
      );
    } catch (error) {
      throw toOwnedDomainError(error, 'Failed to claim domain with Meta');
    }

    if (!response.ok) {
      const metaError = await parseMetaErrorResponse(
        response,
        'Failed to claim domain with Meta'
      );
      const failure = toOwnedDomainError(metaError, metaError.message);

      if (failure.reason !== 'already_owned_elsewhere') throw failure;

      // Meta says it is claimed. If it is claimed by US — a racing worker, or
      // a claim that landed despite a timeout — that is success.
      const recheck = await this.getOwnedDomain(wanted);
      if (recheck) return { outcome: 'already_owned', ownedDomain: recheck };

      throw new MetaOwnedDomainError(
        'already_owned_elsewhere',
        `${wanted} is already claimed by a different Meta business account.`,
        metaError
      );
    }

    const json = (await response.json()) as Record<string, unknown>;
    const created = toOwnedDomain({ domain: wanted, ...json });

    // The POST response is thin on some account shapes; the read-back is what
    // guarantees the caller gets a token and a status to store.
    if (!created.verificationToken || !created.verificationStatus) {
      const readBack = await this.getOwnedDomain(wanted).catch(() => null);
      if (readBack) {
        return {
          outcome: 'claimed',
          ownedDomain: {
            ...readBack,
            verificationToken:
              created.verificationToken ?? readBack.verificationToken,
          },
        };
      }
    }

    return { outcome: 'claimed', ownedDomain: created };
  }
}

/**
 * Which Business Manager owns an ad account.
 *
 * The credential resolver (`getMetaCredentials`) hands out an ad account, not
 * a business, and the integration's cached `available_businesses` JSONB is
 * cleared once setup completes — so asking Meta is the only answer that is
 * both always available and never stale. One extra GET on a path that runs at
 * most a few times per domain.
 */
export const fetchAdAccountBusinessId = async (input: {
  accessToken: string;
  adAccountId: string;
  appSecret?: string;
}): Promise<string | null> => {
  const adAccountId = input.adAccountId.startsWith('act_')
    ? input.adAccountId
    : `act_${input.adAccountId}`;

  const params = new URLSearchParams({
    access_token: input.accessToken,
    fields: 'business',
  });
  if (input.appSecret) {
    params.set(
      'appsecret_proof',
      createHmac('sha256', input.appSecret)
        .update(input.accessToken)
        .digest('hex')
    );
  }

  const response = await fetchWithRetry(
    `${GRAPH_API_BASE}/${adAccountId}?${params.toString()}`,
    { method: 'GET' }
  );
  if (!response.ok) {
    throw toOwnedDomainError(
      await parseMetaErrorResponse(
        response,
        'Failed to read the ad account business'
      ),
      'Failed to read the ad account business'
    );
  }

  const json = (await response.json()) as { business?: { id?: string } };
  return json.business?.id ?? null;
};
