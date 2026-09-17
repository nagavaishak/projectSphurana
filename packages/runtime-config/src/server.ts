import { runtimeConfigEnvMap as envMap } from './env-map.js';
import { type RuntimeConfig, runtimeConfigSchema } from './schema.js';

export type ServerConfigSource = Readonly<Record<string, string | undefined>>;

const getProcessEnv = (): ServerConfigSource => {
  if (typeof process !== 'undefined' && process.env) {
    return process.env as ServerConfigSource;
  }
  return {};
};

export function getServerConfig(
  source: ServerConfigSource = getProcessEnv()
): RuntimeConfig {
  const raw: Record<string, unknown> = {};
  for (const [key, envName] of Object.entries(envMap)) {
    const value = source[envName];
    if (value !== undefined && value !== '') {
      raw[key] = value;
    }
  }

  const result = runtimeConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid runtime config: ${issues}`);
  }
  return result.data;
}

export { runtimeConfigSchema, type RuntimeConfig } from './schema.js';
