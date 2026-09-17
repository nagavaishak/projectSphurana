import { z } from 'zod';

const normalizeUrl = (v: string) => {
  const trimmed = v.trim();
  if (trimmed && !/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
};

export const debugContentSchema = z.object({
  websiteUrl: z
    .string()
    .transform(normalizeUrl)
    .pipe(z.string().url('Invalid website URL')),
});

export type DebugContentInput = z.infer<typeof debugContentSchema>;

export interface ExtractedService {
  name: string;
  category: string | null;
  price: number | null;
  duration: number | null;
  deposit: number | null;
  priceType: string | null;
  description: string | null;
}

export interface ExtractedContent {
  /** The raw HTML (truncated) */
  rawHtml: string;
  /** Extracted text content */
  extractedText: string;
  /** Page title */
  title: string | null;
  /** Meta description */
  metaDescription: string | null;
  /** OG tags found */
  ogTags: Record<string, string>;
  /** Colors found */
  colors: string[];
  /** Logo URL */
  logoUrl: string | null;
  /** Social media links found */
  socialLinks: Array<{ platform: string; url: string }>;
  /** Font families detected */
  fonts: string[];
  /** Booking/appointment links found */
  bookingLinks: string[];
  /** JSON-LD structured data */
  jsonLd: unknown[];
  /** Livewire/framework embedded data (services, categories, etc.) */
  embeddedData: unknown | null;
  /** Services extracted from structured data (Livewire, JSON-LD, etc.) */
  services: ExtractedService[];
  /** How long extraction took (ms) */
  durationMs: number;
}

export interface NavigationStep {
  action: string;
  url: string;
  reasoning: string;
}

export interface DebugContentResponse {
  url: string;
  /** Content from plain fetch() - what current method sees */
  fetchMethod: ExtractedContent;
  /** Content from Playwright browser render - what new method would see */
  browserMethod: ExtractedContent | null;
  /** Why browser method failed, if it did */
  browserError: string | null;
  /** Log of AI navigation decisions */
  navigationLog: NavigationStep[];
}
