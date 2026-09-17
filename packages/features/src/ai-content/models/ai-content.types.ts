/**
 * AI-generated content response types
 */

export interface AdContent {
  headline: string;
  primaryText: string;
  description: string;
  callToAction: string;
}

export interface SocialPostContent {
  caption: string;
  hashtags: string[];
}

export type GeneratedContent =
  | { contentType: 'ad'; content: AdContent }
  | { contentType: 'social-post'; content: SocialPostContent };
