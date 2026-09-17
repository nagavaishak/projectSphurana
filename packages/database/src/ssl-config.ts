import * as fs from 'node:fs';

export interface SSLConfig {
  rejectUnauthorized: boolean;
  ca?: string;
}

/**
 * Creates SSL configuration based on environment and available certificates
 * @param nodeEnv - The NODE_ENV environment variable
 * @returns SSL configuration object
 */
export function createSSLConfig(nodeEnv?: string): SSLConfig | false {
  const isProduction = nodeEnv === 'production' || nodeEnv === 'staging';

  // No SSL required for development environments
  if (!isProduction) {
    return false;
  }

  try {
    // Try to use the RDS certificate bundle if available
    if (fs.existsSync('/app/rds-combined-ca-bundle.pem')) {
      return {
        ca: fs.readFileSync('/app/rds-combined-ca-bundle.pem').toString(),
        rejectUnauthorized: true,
      };
    }
    // Fallback to system CA certificates for production
    return {
      rejectUnauthorized: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.log('Error reading RDS certificate bundle:', errorMessage);
    // If there's an error reading the certificate, fallback to system CAs
    return {
      rejectUnauthorized: true,
    };
  }
}

/**
 * Creates SSL configuration for Drizzle CLI (string format)
 * @param nodeEnv - The NODE_ENV environment variable
 * @returns SSL string for Drizzle config
 */
export function createDrizzleSSLConfig(
  nodeEnv?: string
): 'require' | 'allow' | 'prefer' | 'verify-full' | false {
  const isProduction = nodeEnv === 'production' || nodeEnv === 'staging';
  const sslValue: 'require' | false = isProduction ? 'require' : false;
  return sslValue;
}
