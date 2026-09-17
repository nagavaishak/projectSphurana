import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

/**
 * Email send options
 */
export interface GmailSendOptions {
  to: string | string[];
  subject: string;
  body: string;
  bodyType?: 'text' | 'html';
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  from?: string; // Display name only, email is from authenticated account
}

/**
 * Email send result
 */
export interface GmailSendResult {
  messageId: string;
  threadId: string;
  labelIds: string[];
}

/**
 * Service for sending emails via Gmail API
 */
export class GmailSendService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Send an email using Gmail API
   * @param options Email send options
   * @returns Send result with message ID
   */
  async sendEmail(options: GmailSendOptions): Promise<GmailSendResult> {
    const rawMessage = this.buildRawMessage(options);

    const response = await fetchWithTimeout(
      `${GMAIL_API_BASE}/users/me/messages/send`,
      {
        timeoutMs: 15000,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          raw: rawMessage,
        }),
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string; code?: number };
      };
      throw new Error(
        `Failed to send email: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      id: string;
      threadId: string;
      labelIds: string[];
    };

    return {
      messageId: data.id,
      threadId: data.threadId,
      labelIds: data.labelIds,
    };
  }

  /**
   * Build a raw RFC 2822 message and encode as base64url
   */
  private buildRawMessage(options: GmailSendOptions): string {
    const toAddresses = Array.isArray(options.to)
      ? options.to.join(', ')
      : options.to;
    const ccAddresses = options.cc
      ? Array.isArray(options.cc)
        ? options.cc.join(', ')
        : options.cc
      : undefined;
    const bccAddresses = options.bcc
      ? Array.isArray(options.bcc)
        ? options.bcc.join(', ')
        : options.bcc
      : undefined;

    const contentType =
      options.bodyType === 'html' ? 'text/html' : 'text/plain';

    const headers: string[] = [
      `To: ${toAddresses}`,
      `Subject: ${this.encodeSubject(options.subject)}`,
      'MIME-Version: 1.0',
      `Content-Type: ${contentType}; charset=utf-8`,
    ];

    if (options.from) {
      headers.push(`From: ${options.from}`);
    }

    if (ccAddresses) {
      headers.push(`Cc: ${ccAddresses}`);
    }

    if (bccAddresses) {
      headers.push(`Bcc: ${bccAddresses}`);
    }

    if (options.replyTo) {
      headers.push(`Reply-To: ${options.replyTo}`);
    }

    const message = `${headers.join('\r\n')}\r\n\r\n${options.body}`;

    // Base64url encode the message
    return this.base64UrlEncode(message);
  }

  /**
   * Encode subject line for RFC 2047 compliance (handles non-ASCII)
   */
  private encodeSubject(subject: string): string {
    // Check if subject contains non-ASCII characters (charCode > 127)
    const hasNonAscii = [...subject].some((char) => char.charCodeAt(0) > 127);
    if (hasNonAscii) {
      const encoded = Buffer.from(subject, 'utf-8').toString('base64');
      return `=?UTF-8?B?${encoded}?=`;
    }
    return subject;
  }

  /**
   * Base64url encode a string (Gmail API requirement)
   */
  private base64UrlEncode(str: string): string {
    return Buffer.from(str, 'utf-8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  /**
   * Get the authenticated user's email address
   * @returns User's email address
   */
  async getProfile(): Promise<{ emailAddress: string; messagesTotal: number }> {
    const response = await fetchWithRetry(
      `${GMAIL_API_BASE}/users/me/profile`,
      {
        timeoutMs: 15000,
        headers: { Authorization: `Bearer ${this.accessToken}` },
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to get profile: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      emailAddress: string;
      messagesTotal: number;
    };

    return {
      emailAddress: data.emailAddress,
      messagesTotal: data.messagesTotal,
    };
  }
}
