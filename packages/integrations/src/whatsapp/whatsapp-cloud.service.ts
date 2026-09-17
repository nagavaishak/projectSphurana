import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';
import { logError } from '@borradh-workspace/observability';
import { GRAPH_API_VERSION } from '../shared/graph-api.js';
import { parseMetaErrorResponse } from '../shared/meta-api-error.js';

export interface WhatsAppTemplateMessage {
  to: string;
  templateName: string;
  languageCode: string;
  parameters?: Record<string, string>;
}

export interface WhatsAppMessageResult {
  messageId: string;
  success: boolean;
}

export interface WhatsAppTemplate {
  id: string;
  name: string;
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED' | 'DISABLED';
  category: string;
  language: string;
  components: Array<{
    type: string;
    text?: string;
    format?: string;
    example?: { body_text?: string[][] };
  }>;
}

export interface CreateWhatsAppTemplateInput {
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  body: string;
  headerText?: string;
  footerText?: string;
  /**
   * One sample value per `{{n}}` in `body`, in order.
   *
   * REQUIRED by Meta whenever the body has variables — a template submitted
   * without samples is auto-rejected with `INVALID_FORMAT` and never reaches a
   * human reviewer. Omitting this is why variable templates always failed here.
   */
  bodyExample?: string[];
}

/** Why a number cannot start a conversation, if it cannot. */
export interface WhatsAppSendBlocker {
  /** PHONE_NUMBER | WABA | BUSINESS | APP */
  entityType: string;
  code: number;
  description: string;
  solution: string;
}

export interface WhatsAppSendHealth {
  canSendMessage: 'AVAILABLE' | 'LIMITED' | 'BLOCKED' | 'UNKNOWN';
  blockers: WhatsAppSendBlocker[];
}

export interface WhatsAppWebhookEvent {
  type: 'message' | 'status';
  from: string;
  to: string;
  messageId: string;
  timestamp: number;
  body?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
}

/**
 * Thin wrapper around the WhatsApp Cloud (Graph API) endpoints.
 *
 * Error handling: any non-2xx response is converted to a MetaApiError via
 * parseMetaErrorResponse and thrown. Callers in the features package wrap
 * this through handleWhatsAppError → handleMetaError so that known WhatsApp
 * error codes (24h window expired, recipient blocked, template paused, etc.)
 * are returned as structured FeatureErrors and NOT logged to Sentry as bugs.
 *
 * Do not add unconditional logError() calls in this file — let typed errors
 * propagate so the registry-driven handler can decide what to log.
 */
export class WhatsAppCloudService {
  private accessToken: string;
  private phoneNumberId: string;
  private apiVersion: string;

  constructor(accessToken?: string, phoneNumberId?: string) {
    this.accessToken = accessToken || process.env.WHATSAPP_ACCESS_TOKEN || '';
    this.phoneNumberId =
      phoneNumberId || process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    this.apiVersion = process.env.WHATSAPP_API_VERSION || GRAPH_API_VERSION;

    if (!this.accessToken || !this.phoneNumberId) {
      throw new Error('WhatsApp access token and phone number ID are required');
    }
  }

  /**
   * Send a plain text message via WhatsApp Cloud API
   * @param recipientPhone Recipient phone number (E.164 format)
   * @param text Message text content
   * @returns Message ID and success status
   */
  async sendTextMessage(
    recipientPhone: string,
    text: string
  ): Promise<WhatsAppMessageResult> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhone,
      type: 'text',
      text: { body: text },
    };

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      timeoutMs: 15000,
    });

    if (!response.ok) {
      throw await parseMetaErrorResponse(response, 'WhatsApp sendTextMessage');
    }

    const data = (await response.json()) as {
      messages?: Array<{ id: string }>;
    };

    return {
      messageId: data.messages?.[0]?.id || '',
      success: true,
    };
  }

  /**
   * Send a media (image or video) message via WhatsApp Cloud API.
   * @param recipientPhone Recipient phone number (E.164 format)
   * @param opts Media type, hosted media URL, and optional caption
   * @returns Message ID and success status
   */
  async sendMediaMessage(
    recipientPhone: string,
    opts: { type: 'image' | 'video'; link: string; caption?: string }
  ): Promise<WhatsAppMessageResult> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhone,
      type: opts.type,
      [opts.type]: {
        link: opts.link,
        ...(opts.caption ? { caption: opts.caption } : {}),
      },
    };

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw await parseMetaErrorResponse(response, 'WhatsApp sendMediaMessage');
    }

    const data = (await response.json()) as {
      messages?: Array<{ id: string }>;
    };

    return {
      messageId: data.messages?.[0]?.id || '',
      success: true,
    };
  }

  /**
   * Send a template message via WhatsApp Cloud API
   * @param message Template message details
   * @returns Message ID and success status
   */
  async sendTemplateMessage(
    message: WhatsAppTemplateMessage
  ): Promise<WhatsAppMessageResult> {
    const { to, templateName, languageCode, parameters } = message;

    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    // Build template components
    const components = [];
    if (parameters && Object.keys(parameters).length > 0) {
      components.push({
        type: 'body',
        parameters: Object.values(parameters).map((value) => ({
          type: 'text',
          text: value,
        })),
      });
    }

    const payload = {
      messaging_product: 'whatsapp',
      to: to,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        ...(components.length > 0 && { components }),
      },
    };

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      timeoutMs: 15000,
    });

    if (!response.ok) {
      throw await parseMetaErrorResponse(
        response,
        'WhatsApp sendTemplateMessage'
      );
    }

    const data = (await response.json()) as {
      messages?: Array<{ id: string }>;
    };

    return {
      messageId: data.messages?.[0]?.id || '',
      success: true,
    };
  }

  /**
   * Can this number actually start a conversation right now?
   *
   * **Meta accepts business-initiated sends it has already decided never to
   * deliver.** A blocked WABA still returns 200 with a `wamid` and
   * `message_status: "accepted"`, and the message is silently dropped — no
   * error, nothing in the send response to distinguish it from success. The
   * only way to know beforehand is to ask.
   *
   * Real example this exists for: a WABA with no valid payment method reports
   * `141006 — There is an error with the payment method. This will block
   * business initiated conversations.` Everything else about the account looked
   * healthy: number CONNECTED, quality GREEN, review APPROVED, business
   * verified.
   *
   * Errors are rolled up across every entity Meta reports on (phone number,
   * WABA, business, app), because any one of them can be the blocker.
   */
  async getSendHealth(phoneNumberId?: string): Promise<WhatsAppSendHealth> {
    const id = phoneNumberId ?? this.phoneNumberId;
    const url = `https://graph.facebook.com/${this.apiVersion}/${id}?fields=health_status`;

    const response = await fetchWithTimeout(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      timeoutMs: 10000,
    });
    if (!response.ok) {
      throw await parseMetaErrorResponse(response, 'WhatsApp getSendHealth');
    }

    const data = (await response.json()) as {
      health_status?: {
        can_send_message?: string;
        entities?: Array<{
          entity_type?: string;
          can_send_message?: string;
          errors?: Array<{
            error_code?: number;
            error_description?: string;
            possible_solution?: string;
          }>;
        }>;
      };
    };

    const status = data.health_status;
    const blockers = (status?.entities ?? [])
      // Only entities that actually stop a send — an entity can carry unrelated
      // errors (SIP/calling) while messaging is fine.
      .filter((e) => e.can_send_message === 'BLOCKED')
      .flatMap((e) =>
        (e.errors ?? []).map((err) => ({
          entityType: e.entity_type ?? 'UNKNOWN',
          code: err.error_code ?? 0,
          description: err.error_description ?? '',
          solution: err.possible_solution ?? '',
        }))
      );

    return {
      canSendMessage:
        (status?.can_send_message as WhatsAppSendHealth['canSendMessage']) ??
        'UNKNOWN',
      blockers,
    };
  }

  /**
   * List message templates for a WhatsApp Business Account
   * @param wabaId WhatsApp Business Account ID
   * @returns List of templates
   */
  async listTemplates(wabaId: string): Promise<WhatsAppTemplate[]> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${wabaId}/message_templates?fields=id,name,status,category,language,components&access_token=${this.accessToken}`;

    const response = await fetchWithRetry(url, { timeoutMs: 15000 });

    if (!response.ok) {
      throw await parseMetaErrorResponse(response, 'WhatsApp listTemplates');
    }

    const data = (await response.json()) as {
      data?: Array<{
        id: string;
        name: string;
        status: string;
        category: string;
        language: string;
        components: Array<{
          type: string;
          text?: string;
          format?: string;
          example?: { body_text?: string[][] };
        }>;
      }>;
    };

    return (data.data || []).map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status as WhatsAppTemplate['status'],
      category: t.category,
      language: t.language,
      components: t.components,
    }));
  }

  /**
   * Create a message template for a WhatsApp Business Account
   * @param wabaId WhatsApp Business Account ID
   * @param template Template details
   * @returns Created template
   */
  async createTemplate(
    wabaId: string,
    template: CreateWhatsAppTemplateInput
  ): Promise<{ id: string; status: string }> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${wabaId}/message_templates`;

    const components: Array<Record<string, unknown>> = [];

    if (template.headerText) {
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: template.headerText,
      });
    }

    // Meta counts placeholders itself; if the body has any, it demands a
    // matching example row. Derive the count from the body so a caller cannot
    // silently supply the wrong number.
    const placeholders = new Set(
      [...template.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1])
    );
    const body: Record<string, unknown> = {
      type: 'BODY',
      text: template.body,
    };
    if (placeholders.size > 0) {
      const samples = template.bodyExample ?? [];
      if (samples.length !== placeholders.size) {
        throw new Error(
          `WhatsApp createTemplate: body has ${placeholders.size} variable(s) but ${samples.length} example(s) were supplied. Meta rejects a variable template with no matching examples (INVALID_FORMAT).`
        );
      }
      body.example = { body_text: [samples] };
    }
    components.push(body);

    if (template.footerText) {
      components.push({
        type: 'FOOTER',
        text: template.footerText,
      });
    }

    const payload = {
      name: template.name,
      category: template.category,
      language: template.language,
      components,
    };

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      timeoutMs: 15000,
    });

    if (!response.ok) {
      throw await parseMetaErrorResponse(response, 'WhatsApp createTemplate');
    }

    const data = (await response.json()) as {
      id: string;
      status: string;
    };

    return { id: data.id, status: data.status };
  }

  /**
   * Send an interactive list message via WhatsApp Cloud API.
   * @param recipientPhone Recipient phone number (E.164 format)
   * @param opts Interactive message configuration (list type)
   * @returns Message ID and success status
   */
  async sendInteractiveMessage(
    recipientPhone: string,
    opts: {
      type: 'list';
      header?: string;
      body: string;
      footer?: string;
      buttonText: string;
      sections: Array<{
        title?: string;
        rows: Array<{
          id: string;
          title: string;
          description?: string;
        }>;
      }>;
    }
  ): Promise<WhatsAppMessageResult> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhone,
      type: 'interactive',
      interactive: {
        type: opts.type,
        ...(opts.header ? { header: { type: 'text', text: opts.header } } : {}),
        body: { text: opts.body },
        ...(opts.footer ? { footer: { text: opts.footer } } : {}),
        action: {
          button: opts.buttonText,
          sections: opts.sections,
        },
      },
    };

    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw await parseMetaErrorResponse(
        response,
        'WhatsApp sendInteractiveMessage'
      );
    }

    const data = (await response.json()) as {
      messages?: Array<{ id: string }>;
    };

    return {
      messageId: data.messages?.[0]?.id || '',
      success: true,
    };
  }

  /**
   * Delete a message template
   * @param wabaId WhatsApp Business Account ID
   * @param templateName Template name to delete
   */
  async deleteTemplate(wabaId: string, templateName: string): Promise<boolean> {
    const url = `https://graph.facebook.com/${this.apiVersion}/${wabaId}/message_templates?name=${encodeURIComponent(templateName)}`;

    const response = await fetchWithTimeout(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
      timeoutMs: 15000,
    });

    if (!response.ok) {
      throw await parseMetaErrorResponse(response, 'WhatsApp deleteTemplate');
    }

    return true;
  }

  /**
   * Parse webhook event from Meta
   * @param webhookData Raw webhook payload
   * @returns Parsed WhatsApp event
   */
  parseWebhookEvent(webhookData: unknown): WhatsAppWebhookEvent | null {
    try {
      const data = webhookData as Record<string, unknown>;
      const entry = (data.entry as Record<string, unknown>[])?.[0];
      const changes = (entry?.changes as Record<string, unknown>[])?.[0];
      const value = changes?.value as Record<string, unknown> | undefined;

      if (!value) return null;

      // Handle message event
      const messages = value.messages as Record<string, unknown>[] | undefined;
      if (messages) {
        const message = messages[0];
        const metadata = value.metadata as Record<string, unknown> | undefined;
        const text = message.text as Record<string, unknown> | undefined;
        return {
          type: 'message',
          from: message.from as string,
          to: (metadata?.display_phone_number as string) || '',
          messageId: message.id as string,
          timestamp: message.timestamp as number,
          body: text?.body as string | undefined,
        };
      }

      // Handle status event
      const statuses = value.statuses as Record<string, unknown>[] | undefined;
      if (statuses) {
        const status = statuses[0];
        return {
          type: 'status',
          from: status.recipient_id as string,
          to: '',
          messageId: status.id as string,
          timestamp: status.timestamp as number,
          status: status.status as 'sent' | 'delivered' | 'read' | 'failed',
        };
      }

      return null;
    } catch (error) {
      // Webhook parsing errors are real bugs — keep logging these.
      logError('whatsapp.parseWebhookEvent', error, { feature: 'whatsapp' });
      return null;
    }
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
}
