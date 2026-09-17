import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { logError } from '@borradh-workspace/observability';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  body: string;
  from?: string;
  replyTo?: string;
  cc?: string[];
  bcc?: string[];
}

export interface SendEmailResult {
  messageId: string;
  success: boolean;
}

export class SESEmailService {
  private client: SESClient;
  private defaultFromEmail: string;

  constructor(region?: string, fromEmail?: string) {
    this.client = new SESClient({
      region: region || process.env.AWS_REGION || 'us-east-1',
    });
    this.defaultFromEmail =
      fromEmail || process.env.SES_FROM_EMAIL || 'noreply@example.com';
  }

  /**
   * Send an email via Amazon SES
   * @param options Email sending options
   * @returns Message ID and success status
   */
  async sendEmail(options: SendEmailOptions): Promise<SendEmailResult> {
    const { to, subject, body, from, replyTo, cc, bcc } = options;

    const toAddresses = Array.isArray(to) ? to : [to];

    const command = new SendEmailCommand({
      Source: from || this.defaultFromEmail,
      Destination: {
        ToAddresses: toAddresses,
        CcAddresses: cc,
        BccAddresses: bcc,
      },
      Message: {
        Subject: {
          Data: subject,
          Charset: 'UTF-8',
        },
        Body: {
          Html: {
            Data: body,
            Charset: 'UTF-8',
          },
        },
      },
      ReplyToAddresses: replyTo ? [replyTo] : undefined,
    });

    try {
      const response = await this.client.send(command);
      return {
        messageId: response.MessageId || '',
        success: true,
      };
    } catch (error) {
      logError('ses.sendEmail', error, { feature: 'email' });
      throw error;
    }
  }

  /**
   * Send a templated email via Amazon SES
   * @param to Recipient email address(es)
   * @param templateName Name of the SES template
   * @param templateData Data to populate the template
   * @param from Optional sender email
   * @returns Message ID and success status
   */
  async sendTemplatedEmail(
    _to: string | string[],
    _templateName: string,
    _templateData: Record<string, string>,
    _from?: string
  ): Promise<SendEmailResult> {
    // Note: Implement templated email sending when needed
    // For now, this is a placeholder
    throw new Error('Templated email not yet implemented');
  }
}
