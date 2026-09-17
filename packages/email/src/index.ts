// @borradh-workspace/email

// Email sending utilities
export { sendEmail } from './send.js';
export type { SendEmailOptions, SendEmailResult } from './send.js';

// Raw HTML email (used by sequence executor for platform email)
export { sendHtmlEmail } from './send-html.js';
export type { SendHtmlEmailOptions, SendHtmlEmailResult } from './send-html.js';

// Email client utilities
export { testConnection } from './client.js';

// Errors
export { ResendSendError } from './errors.js';

// Email templates
export * from './templates/index.js';
