/**
 * UTM handling for microsite traffic (plan §9 "A domain change breaks
 * attribution", §11).
 *
 * THE LOAD-BEARING DECISION, stated once so nobody has to re-derive it:
 * `utm_campaign` carries the **Meta campaign id**, not the campaign's display
 * name. A name is editable in our UI and in Ads Manager; the day someone
 * renames "Spring Offer" to "Spring Offer v2" every lead booked before the
 * rename stops joining to spend, and the CAC number quietly halves. The id
 * never changes, and it is the primary key of
 * `meta_campaign_daily_insights.meta_campaign_id` — so the join is a plain
 * equality on a stable value.
 *
 * The host appears NOWHERE in this file. Which host a link is built on is
 * `shared/microsite-host.ts`'s job and is re-decided on every build; what we
 * PERSIST against a lead is `micrositeId` plus these five params, none of which
 * move when `salon.borradh.io` becomes `salon.com`.
 *
 * Pure and synchronous on purpose — these run inside link builders on
 * email-send and ad-creation paths.
 */

/** The five standard params, in the shape we store them on the lead. */
export interface MicrositeUtm {
  source?: string | null;
  medium?: string | null;
  campaign?: string | null;
  content?: string | null;
  term?: string | null;
}

/** Query-string key for each field. */
const UTM_PARAM: Record<keyof MicrositeUtm, string> = {
  source: 'utm_source',
  medium: 'utm_medium',
  campaign: 'utm_campaign',
  content: 'utm_content',
  term: 'utm_term',
};

const UTM_FIELDS = Object.keys(UTM_PARAM) as (keyof MicrositeUtm)[];

/** Everything we send from a Meta ad is tagged with this pair. */
export const META_UTM_SOURCE = 'meta';
export const META_UTM_MEDIUM = 'paid_social';

/**
 * The UTMs for one Meta campaign.
 *
 * `adId` lands in `utm_content` when the caller knows it (per-ad breakdown);
 * campaign creation does not, and omitting it is fine — the campaign-level
 * join is what CAC needs.
 */
export const metaCampaignUtm = (
  metaCampaignId: string,
  adId?: string
): MicrositeUtm => ({
  source: META_UTM_SOURCE,
  medium: META_UTM_MEDIUM,
  campaign: metaCampaignId,
  ...(adId ? { content: adId } : {}),
});

/** True when at least one param carries a value. */
export const hasUtm = (utm: MicrositeUtm): boolean =>
  UTM_FIELDS.some((field) => {
    const value = utm[field];
    return typeof value === 'string' && value.length > 0;
  });

/**
 * Append UTMs to a URL, preserving whatever the URL already carries.
 *
 * Existing params are OVERWRITTEN for the keys we set and left alone for the
 * rest — a destination that already had `?service=botox` keeps it. Returns the
 * input unchanged when the URL cannot be parsed, so a malformed destination
 * degrades to "no tagging" instead of throwing on an ad-creation path.
 */
export const appendUtmParams = (rawUrl: string, utm: MicrositeUtm): string => {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  for (const field of UTM_FIELDS) {
    const value = utm[field];
    if (typeof value === 'string' && value.length > 0) {
      url.searchParams.set(UTM_PARAM[field], value);
    }
  }
  return url.toString();
};

/**
 * Read UTMs back off a landing URL (or a bare query string / search params).
 *
 * The microsite hands us whatever the browser was on; a value we cannot read is
 * simply absent rather than an error, because a visitor who arrived organically
 * is the common case, not a failure.
 */
export const parseUtmParams = (
  input: string | URLSearchParams
): MicrositeUtm => {
  let params: URLSearchParams;
  if (input instanceof URLSearchParams) {
    params = input;
  } else {
    try {
      params = new URL(input).searchParams;
    } catch {
      params = new URLSearchParams(
        input.startsWith('?') ? input.slice(1) : input
      );
    }
  }

  const utm: MicrositeUtm = {};
  for (const field of UTM_FIELDS) {
    const value = params.get(UTM_PARAM[field]);
    if (value) utm[field] = value;
  }
  return utm;
};
