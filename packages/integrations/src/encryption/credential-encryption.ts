import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';

function getEncryptionKey(): Buffer {
  const key = process.env.INTEGRATION_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'INTEGRATION_ENCRYPTION_KEY environment variable is not set'
    );
  }
  return Buffer.from(key, 'hex');
}

/**
 * Encrypts credential data using AES-256-GCM
 * @param data Object containing sensitive credential data
 * @returns Encrypted string in format: iv:authTag:encryptedData
 */
export function encryptCredentials(data: object): string {
  const KEY = getEncryptionKey();
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, KEY, iv);

  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypts credential data
 * @param encryptedData Encrypted string from encryptCredentials
 * @returns Decrypted object
 */
export function decryptCredentials<T = object>(encryptedData: string): T {
  const KEY = getEncryptionKey();
  const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

  if (!ivHex || !authTagHex || !encrypted) {
    throw new Error('Invalid encrypted data format');
  }

  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const decipher = createDecipheriv(ALGORITHM, KEY, iv);

  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');

  return JSON.parse(decrypted) as T;
}

/**
 * Generates a new encryption key (32 bytes for AES-256)
 * Use this to generate INTEGRATION_ENCRYPTION_KEY for .env
 */
export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}
