import { fetchWithRetry } from '@borradh-workspace/http';
import { logError } from '@borradh-workspace/observability';
import { GRAPH_API_VERSION } from '../shared/graph-api.js';
import { metaPageSubscribedFields } from '../webhooks/index.js';

export interface FacebookLead {
  id: string;
  createdTime: string;
  formId: string;
  pageId: string;
  adId?: string;
  fieldData: Record<string, string>;
}

export interface FacebookWebhookEntry {
  id: string;
  time: number;
  changes: Array<{
    field: string;
    value: {
      leadgen_id: string;
      form_id: string;
      page_id: string;
      ad_id?: string;
      created_time: number;
    };
  }>;
}

export interface FacebookWebhookPayload {
  object: string;
  entry: FacebookWebhookEntry[];
}

export class FacebookLeadsService {
  private accessToken: string;
  private apiVersion: string;

  constructor(accessToken?: string) {
    this.accessToken = accessToken || process.env.FACEBOOK_ACCESS_TOKEN || '';
    this.apiVersion = process.env.FACEBOOK_API_VERSION || GRAPH_API_VERSION;

    if (!this.accessToken) {
      throw new Error('Facebook access token is required');
    }
  }

  /**
   * Fetch lead details from Facebook Lead Ads API
   * @param leadId The lead ID from the webhook
   * @returns Lead details including form data
   */
  async fetchLead(leadId: string): Promise<FacebookLead> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${leadId}?fields=id,created_time,field_data,form_id,ad_id&access_token=${this.accessToken}`;

    try {
      const response = await fetchWithRetry(url, { timeoutMs: 15000 });

      if (!response.ok) {
        const errorData = (await response.json()) as {
          error?: { message?: string };
        };
        logError('facebook.apiError', errorData, { feature: 'facebook' });
        throw new Error(
          `Facebook API error: ${errorData.error?.message || 'Unknown error'}`
        );
      }

      const data = (await response.json()) as {
        id: string;
        created_time: string;
        form_id: string;
        ad_id?: string;
        field_data?: Array<{ name: string; values?: string[] }>;
      };

      // Transform field_data array into a key-value object
      const fieldData: Record<string, string> = {};
      if (data.field_data && Array.isArray(data.field_data)) {
        for (const field of data.field_data) {
          fieldData[field.name] = field.values?.[0] || '';
        }
      }

      return {
        id: data.id,
        createdTime: data.created_time,
        formId: data.form_id,
        pageId: '', // Page ID comes from webhook, not lead API
        adId: data.ad_id,
        fieldData,
      };
    } catch (err) {
      logError('facebook.fetchLead', err, { feature: 'facebook' });
      throw err;
    }
  }

  /**
   * Parse webhook payload from Meta
   * @param webhookData Raw webhook payload
   * @returns Array of lead IDs to process
   */
  parseWebhook(webhookData: FacebookWebhookPayload): Array<{
    leadId: string;
    formId: string;
    pageId: string;
    adId?: string;
  }> {
    const leads: Array<{
      leadId: string;
      formId: string;
      pageId: string;
      adId?: string;
    }> = [];

    if (webhookData.object !== 'page') {
      return leads;
    }

    for (const entry of webhookData.entry) {
      for (const change of entry.changes) {
        if (change.field === 'leadgen') {
          leads.push({
            leadId: change.value.leadgen_id,
            formId: change.value.form_id,
            pageId: change.value.page_id,
            adId: change.value.ad_id,
          });
        }
      }
    }

    return leads;
  }

  /**
   * Verify webhook signature
   * @param signature Signature from X-Hub-Signature-256 header
   * @param payload Raw webhook payload
   * @returns Whether signature is valid
   */
  verifyWebhookSignature(signature: string, payload: string): boolean {
    const crypto = require('node:crypto');
    const appSecret = process.env.META_APP_SECRET || '';

    if (!appSecret) {
      throw new Error('META_APP_SECRET is not set');
    }

    const expectedSignature = crypto
      .createHmac('sha256', appSecret)
      .update(payload)
      .digest('hex');

    return signature === `sha256=${expectedSignature}`;
  }

  /**
   * Subscribe to a page's lead forms
   * @param pageId Facebook Page ID
   * @param pageAccessToken Page access token
   * @returns Success status
   */
  async subscribePage(
    pageId: string,
    pageAccessToken: string
  ): Promise<boolean> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${pageId}/subscribed_apps`;

    try {
      const response = await fetchWithRetry(url, {
        method: 'POST',
        timeoutMs: 15000,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          subscribed_fields: metaPageSubscribedFields,
          access_token: pageAccessToken,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        logError('facebook.subscribePage', error, { feature: 'facebook' });
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to subscribe page:', error);
      return false;
    }
  }
}
