# @borradh-workspace/integrations

Integration services for external APIs used in lead follow-up sequences.

## Services

### Email (Amazon SES)
Send emails via Amazon SES.

```typescript
import { SESEmailService } from '@borradh-workspace/integrations/email';

const emailService = new SESEmailService();

await emailService.sendEmail({
  to: 'lead@example.com',
  subject: 'Welcome!',
  body: '<p>Thank you for your interest!</p>',
});
```

### SMS (Amazon SNS)
Send SMS messages via Amazon SNS.

```typescript
import { SNSSMSService } from '@borradh-workspace/integrations/sms';

const smsService = new SNSSMSService();

await smsService.sendSMS({
  phoneNumber: '+1234567890',
  message: 'Thank you for your interest!',
});
```

### WhatsApp (Meta Cloud API)
Send WhatsApp messages via Meta's Cloud API.

```typescript
import { WhatsAppCloudService } from '@borradh-workspace/integrations/whatsapp';

const whatsappService = new WhatsAppCloudService();

await whatsappService.sendTemplateMessage({
  to: '+1234567890',
  templateName: 'welcome_message',
  languageCode: 'en',
  parameters: { name: 'John' },
});
```

### Facebook Lead Forms
Handle Facebook Lead Forms webhooks.

```typescript
import { FacebookLeadsService } from '@borradh-workspace/integrations/facebook';

const fbService = new FacebookLeadsService();

// Parse webhook
const leads = fbService.parseWebhook(webhookPayload);

// Fetch lead details
for (const { leadId } of leads) {
  const lead = await fbService.fetchLead(leadId);
  console.log(lead.fieldData);
}
```

### Credential Encryption
Securely encrypt/decrypt integration credentials.

```typescript
import { encryptCredentials, decryptCredentials } from '@borradh-workspace/integrations/encryption';

// Encrypt
const encrypted = encryptCredentials({ apiKey: 'secret' });

// Decrypt
const credentials = decryptCredentials<{ apiKey: string }>(encrypted);
```

## Environment Variables

```env
# AWS
AWS_REGION=us-east-1

# Amazon SES
SES_FROM_EMAIL=noreply@example.com

# WhatsApp
WHATSAPP_ACCESS_TOKEN=your-access-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_APP_SECRET=your-app-secret
WHATSAPP_API_VERSION=v18.0

# Facebook
FACEBOOK_ACCESS_TOKEN=your-access-token
FACEBOOK_APP_SECRET=your-app-secret
FACEBOOK_API_VERSION=v18.0

# Encryption
INTEGRATION_ENCRYPTION_KEY=your-256-bit-hex-key
```

## Generating Encryption Key

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
