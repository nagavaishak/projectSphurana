import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { logError } from '@borradh-workspace/observability';

export interface SendSMSOptions {
  phoneNumber: string;
  message: string;
  senderId?: string;
  smsType?: 'Promotional' | 'Transactional';
}

export interface SendSMSResult {
  messageId: string;
  success: boolean;
}

export class SNSSMSService {
  private client: SNSClient;

  constructor(region?: string) {
    this.client = new SNSClient({
      region: region || process.env.AWS_REGION || 'us-east-1',
    });
  }

  /**
   * Send an SMS message via Amazon SNS
   * @param options SMS sending options
   * @returns Message ID and success status
   */
  async sendSMS(options: SendSMSOptions): Promise<SendSMSResult> {
    const {
      phoneNumber,
      message,
      senderId,
      smsType = 'Transactional',
    } = options;

    // Ensure phone number is in E.164 format (e.g., +1234567890)
    const formattedNumber = phoneNumber.startsWith('+')
      ? phoneNumber
      : `+${phoneNumber}`;

    const command = new PublishCommand({
      PhoneNumber: formattedNumber,
      Message: message,
      MessageAttributes: {
        'AWS.SNS.SMS.SMSType': {
          DataType: 'String',
          StringValue: smsType,
        },
        ...(senderId && {
          'AWS.SNS.SMS.SenderID': {
            DataType: 'String',
            StringValue: senderId,
          },
        }),
      },
    });

    try {
      console.log('[SNS SMS] Sending to:', formattedNumber);
      console.log('[SNS SMS] Region:', process.env.AWS_REGION || 'us-east-1');
      const response = await this.client.send(command);
      console.log('[SNS SMS] Response:', JSON.stringify(response, null, 2));
      return {
        messageId: response.MessageId || '',
        success: true,
      };
    } catch (error) {
      logError('sns.sendSMS', error, { feature: 'sms' });
      throw error;
    }
  }

  /**
   * Send SMS to multiple recipients
   * @param phoneNumbers Array of phone numbers
   * @param message SMS message
   * @param senderId Optional sender ID
   * @returns Array of results for each recipient
   */
  async sendBulkSMS(
    phoneNumbers: string[],
    message: string,
    senderId?: string
  ): Promise<SendSMSResult[]> {
    const results = await Promise.allSettled(
      phoneNumbers.map((phoneNumber) =>
        this.sendSMS({ phoneNumber, message, senderId })
      )
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      }
      logError('sns.sendBulkSMS', result.reason, {
        feature: 'sms',
        extra: { phoneNumber: phoneNumbers[index] },
      });
      return {
        messageId: '',
        success: false,
      };
    });
  }
}
