export interface ExtractedServiceData {
  name: string;
  pricingDescription?: string;
}

export interface StrategyResult {
  services: ExtractedServiceData[];
  /** Raw markdown/text content for the AI analysis prompt (brand voice, etc.) */
  rawContent?: string;
  /** Image URLs discovered that might contain price lists */
  priceListImageUrls?: string[];
  source: 'firecrawl' | 'browserbase' | 'browser-use' | 'ocr' | 'native';
}

export type MergedStrategyMode = 'basic' | 'e-merged';

export interface MergedStrategyConfig {
  firecrawlApiKey?: string;
  browserbaseApiKey?: string;
  browserbaseProjectId?: string;
  browserUseApiKey?: string;
  /** 'basic' = raw content only (original), 'e-merged' = per-source GPT extraction + dedup (default) */
  mode?: MergedStrategyMode;
}
