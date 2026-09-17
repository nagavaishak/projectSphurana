import { fetchWithRetry, fetchWithTimeout } from '@borradh-workspace/http';

const MICROSOFT_GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/**
 * Email send options for Outlook
 */
export interface OutlookSendOptions {
  to: string | string[];
  subject: string;
  body: string;
  bodyType?: 'text' | 'html';
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  importance?: 'low' | 'normal' | 'high';
  saveToSentItems?: boolean;
}

/**
 * Email send result
 */
export interface OutlookSendResult {
  success: boolean;
}

/**
 * Service for sending emails via Microsoft Graph API (Outlook)
 */
export class OutlookSendService {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  /**
   * Send an email using Microsoft Graph API
   * @param options Email send options
   * @returns Send result
   */
  async sendEmail(options: OutlookSendOptions): Promise<OutlookSendResult> {
    const message = this.buildMessage(options);

    const response = await fetchWithTimeout(
      `${MICROSOFT_GRAPH_BASE}/me/sendMail`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message,
          saveToSentItems: options.saveToSentItems ?? true,
        }),
        timeoutMs: 15000,
      }
    );

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string; code?: string };
      };
      throw new Error(
        `Failed to send email: ${error.error?.message || 'Unknown error'}`
      );
    }

    // Microsoft Graph sendMail returns 202 Accepted with no body on success
    return { success: true };
  }

  /**
   * Build the message object for Microsoft Graph API
   */
  private buildMessage(options: OutlookSendOptions): object {
    const toRecipients = this.formatRecipients(options.to);
    const ccRecipients = options.cc
      ? this.formatRecipients(options.cc)
      : undefined;
    const bccRecipients = options.bcc
      ? this.formatRecipients(options.bcc)
      : undefined;

    const message: Record<string, unknown> = {
      subject: options.subject,
      body: {
        contentType: options.bodyType === 'html' ? 'HTML' : 'Text',
        content: options.body,
      },
      toRecipients,
    };

    if (ccRecipients) {
      message.ccRecipients = ccRecipients;
    }

    if (bccRecipients) {
      message.bccRecipients = bccRecipients;
    }

    if (options.replyTo) {
      message.replyTo = [
        {
          emailAddress: { address: options.replyTo },
        },
      ];
    }

    if (options.importance) {
      message.importance = options.importance;
    }

    return message;
  }

  /**
   * Format email addresses into Microsoft Graph recipient format
   */
  private formatRecipients(
    emails: string | string[]
  ): Array<{ emailAddress: { address: string } }> {
    const emailList = Array.isArray(emails) ? emails : [emails];
    return emailList.map((email) => ({
      emailAddress: { address: email },
    }));
  }

  /**
   * Get the authenticated user's email profile
   * @returns User's email address and display name
   */
  async getProfile(): Promise<{
    emailAddress: string;
    displayName: string;
  }> {
    const response = await fetchWithRetry(`${MICROSOFT_GRAPH_BASE}/me`, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
      timeoutMs: 15000,
    });

    if (!response.ok) {
      const error = (await response.json()) as {
        error?: { message?: string };
      };
      throw new Error(
        `Failed to get profile: ${error.error?.message || 'Unknown error'}`
      );
    }

    const data = (await response.json()) as {
      mail: string;
      userPrincipalName: string;
      displayName: string;
    };

    return {
      emailAddress: data.mail || data.userPrincipalName,
      displayName: data.displayName,
    };
  }
}
