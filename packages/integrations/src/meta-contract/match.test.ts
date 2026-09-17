import { describe, expect, it } from 'vitest';
import {
  GRAPH_API_BASE,
  INSTAGRAM_MESSAGING_API_BASE,
} from '../shared/graph-api.js';
import {
  describeGraphRequest,
  isGraphUrl,
  matchGraphRequest,
} from './match.js';

/** Resolve to an endpoint id, or null. Keeps the table below readable. */
function idFor(url: string, method: string): string | null {
  return matchGraphRequest(url, method)?.endpoint.id ?? null;
}

describe('isGraphUrl', () => {
  it('claims both Graph hosts and nothing else', () => {
    expect(isGraphUrl('https://graph.facebook.com/v21.0/me')).toBe(true);
    expect(isGraphUrl('https://graph.instagram.com/v22.0/me')).toBe(true);

    // The pass-through cases that must stay untouched by a Meta-only fake.
    expect(isGraphUrl('https://bucket.s3.eu-west-1.amazonaws.com/key')).toBe(
      false
    );
    expect(isGraphUrl('https://cdn.borradh.io/asset.mp4')).toBe(false);
    expect(isGraphUrl('https://api.openai.com/v1/chat/completions')).toBe(
      false
    );
    expect(isGraphUrl('not a url')).toBe(false);
  });
});

describe('matchGraphRequest — real URL shapes from our call sites', () => {
  const ACT = 'act_123456';
  const PAGE = '987654321';

  it.each([
    // Marketing API — ads
    [`${GRAPH_API_BASE}/${ACT}/campaigns`, 'POST', 'ads.createCampaign'],
    [`${GRAPH_API_BASE}/${ACT}/adsets`, 'POST', 'ads.createAdSet'],
    [`${GRAPH_API_BASE}/${ACT}/adcreatives`, 'POST', 'ads.createAdCreative'],
    [`${GRAPH_API_BASE}/${ACT}/ads`, 'POST', 'ads.createAd'],
    [`${GRAPH_API_BASE}/${ACT}/ads?fields=id,name`, 'GET', 'ads.listAds'],
    [`${GRAPH_API_BASE}/${ACT}/advideos`, 'POST', 'ads.uploadVideo'],
    [`${GRAPH_API_BASE}/${ACT}/adimages`, 'POST', 'ads.uploadImage'],
    [
      `${GRAPH_API_BASE}/${ACT}?fields=funding_source_details{type}`,
      'GET',
      'ads.getFundingSource',
    ],
    [
      `${GRAPH_API_BASE}/${PAGE}/leadgen_forms`,
      'POST',
      'ads.createLeadGenForm',
    ],
    [`${GRAPH_API_BASE}/${PAGE}/subscribed_apps`, 'POST', 'pages.subscribeApp'],

    // Messenger
    [`${GRAPH_API_BASE}/me/messages`, 'POST', 'messaging.send'],
    [
      `${GRAPH_API_BASE}/${PAGE}/conversations?user_id=42`,
      'GET',
      'messaging.listConversations',
    ],

    // Page publishing
    [`${GRAPH_API_BASE}/${PAGE}/feed`, 'POST', 'pages.publishFeed'],
    [`${GRAPH_API_BASE}/${PAGE}/photos`, 'POST', 'pages.publishPhoto'],
    [`${GRAPH_API_BASE}/${PAGE}/videos`, 'POST', 'pages.publishVideo'],
    [`${GRAPH_API_BASE}/${PAGE}/posts?fields=id`, 'GET', 'pages.listPosts'],

    // WhatsApp Cloud
    [`${GRAPH_API_BASE}/55512345/messages`, 'POST', 'whatsapp.sendMessage'],
    [
      `${GRAPH_API_BASE}/waba1/message_templates?fields=id`,
      'GET',
      'whatsapp.listTemplates',
    ],
    [
      `${GRAPH_API_BASE}/waba1/message_templates`,
      'POST',
      'whatsapp.createTemplate',
    ],
    [
      `${GRAPH_API_BASE}/waba1/message_templates?name=x`,
      'DELETE',
      'whatsapp.deleteTemplate',
    ],

    // Instagram host
    [
      `${INSTAGRAM_MESSAGING_API_BASE}/17841400000/media`,
      'POST',
      'instagram.createMedia',
    ],
    [
      `${INSTAGRAM_MESSAGING_API_BASE}/17841400000/media_publish`,
      'POST',
      'instagram.publishMedia',
    ],
    [
      `${INSTAGRAM_MESSAGING_API_BASE}/555?fields=name,username`,
      'GET',
      'instagram.getSenderProfile',
    ],

    // Generic node operations
    [`${GRAPH_API_BASE}/campaign-1`, 'GET', 'node.get'],
    [`${GRAPH_API_BASE}/ad-1`, 'POST', 'node.update'],
    [`${GRAPH_API_BASE}/creative-1`, 'DELETE', 'node.delete'],
    [
      `${GRAPH_API_BASE}/${PAGE}?fields=name,instagram_business_account{id}`,
      'GET',
      'node.get',
    ],
  ])('%s %s → %s', (url, method, expected) => {
    expect(idFor(url as string, method as string)).toBe(expected);
  });
});

describe('matchGraphRequest — ordering is load-bearing', () => {
  it('prefers the account-scoped insights matcher over the generic node one', () => {
    // Both `^/act_x/insights$` and `^/{id}/insights$` match. Registry order
    // decides, and the specific one is declared first.
    expect(idFor(`${GRAPH_API_BASE}/act_9/insights`, 'GET')).toBe(
      'ads.listCampaignInsights'
    );
    expect(idFor(`${GRAPH_API_BASE}/campaign-9/insights`, 'GET')).toBe(
      'ads.nodeInsights'
    );
  });

  it('routes /me/messages to Messenger, not WhatsApp', () => {
    // `^/{id}/messages$` also matches `/me/messages`; messaging.send is first.
    expect(idFor(`${GRAPH_API_BASE}/me/messages`, 'POST')).toBe(
      'messaging.send'
    );
    expect(idFor(`${GRAPH_API_BASE}/15551234/messages`, 'POST')).toBe(
      'whatsapp.sendMessage'
    );
  });

  it('discriminates message_templates by method', () => {
    const url = `${GRAPH_API_BASE}/waba/message_templates`;
    expect(idFor(url, 'GET')).toBe('whatsapp.listTemplates');
    expect(idFor(url, 'POST')).toBe('whatsapp.createTemplate');
    expect(idFor(url, 'DELETE')).toBe('whatsapp.deleteTemplate');
  });

  it('does not match an Instagram path against a Facebook-host entry', () => {
    // `/{id}/feed` is a Facebook page endpoint; the IG host must not claim it.
    expect(idFor(`${INSTAGRAM_MESSAGING_API_BASE}/1/feed`, 'POST')).toBeNull();
  });
});

describe('matchGraphRequest — unmatched', () => {
  it('returns null for a Graph endpoint we do not declare', () => {
    // This is what the fake turns into a hard failure, so a new call site
    // cannot silently escape to real Meta.
    expect(idFor(`${GRAPH_API_BASE}/act_1/somethingnew`, 'POST')).toBeNull();
  });

  it('returns null for non-Graph hosts', () => {
    expect(idFor('https://api.stripe.com/v1/charges', 'POST')).toBeNull();
  });
});

describe('describeGraphRequest', () => {
  it('describes without leaking credentials from the query string', () => {
    const described = describeGraphRequest(
      `${GRAPH_API_BASE}/act_1/ads?access_token=SECRET&appsecret_proof=ALSOSECRET`,
      'post'
    );

    expect(described).toBe('POST /act_1/ads');
    expect(described).not.toContain('SECRET');
  });
});
