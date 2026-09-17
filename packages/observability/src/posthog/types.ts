// PostHog-specific types
export interface PostHogConfig {
  apiKey?: string;
  host?: string;
  flushAt?: number;
  flushInterval?: number;
}

export interface PostHogEventProperties {
  [key: string]: string | number | boolean | null | undefined;
}

export interface PostHogUserProperties {
  email?: string;
  name?: string;
  [key: string]: string | number | boolean | null | undefined;
}
