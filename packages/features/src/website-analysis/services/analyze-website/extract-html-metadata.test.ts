import { describe, expect, it } from '@borradh-workspace/testing';
import {
  extractMetadataFromHtml,
  extractTextFromHtml,
} from './extract-html-metadata.js';

describe('extractMetadataFromHtml', () => {
  it('extracts title', () => {
    const html = '<html><head><title>My Clinic</title></head></html>';
    expect(extractMetadataFromHtml(html)).toContain('Title: My Clinic');
  });

  it('extracts meta description', () => {
    const html = '<meta name="description" content="Best clinic in Dublin">';
    expect(extractMetadataFromHtml(html)).toContain(
      'Description: Best clinic in Dublin'
    );
  });

  it('extracts OG tags', () => {
    const html = `
      <meta property="og:title" content="OG Title Here">
      <meta property="og:description" content="OG Desc">
      <meta property="og:site_name" content="My Site">
    `;
    const result = extractMetadataFromHtml(html);
    expect(result).toContain('OG Title: OG Title Here');
    expect(result).toContain('OG Description: OG Desc');
    expect(result).toContain('Site Name: My Site');
  });

  it('extracts JSON-LD structured data', () => {
    const html = `
      <script type="application/ld+json">{"@type":"LocalBusiness","name":"Test Clinic"}</script>
    `;
    const result = extractMetadataFromHtml(html);
    expect(result).toContain('Structured data:');
    expect(result).toContain('Test Clinic');
  });

  it('limits JSON-LD blocks to 3', () => {
    const blocks = Array.from(
      { length: 5 },
      (_, i) => `<script type="application/ld+json">{"block":${i}}</script>`
    ).join('');
    const result = extractMetadataFromHtml(blocks);
    // Should contain blocks 0, 1, 2 but not 3, 4
    expect(result).toContain('"block":0');
    expect(result).toContain('"block":2');
    expect(result).not.toContain('"block":3');
  });

  it('skips malformed JSON-LD gracefully', () => {
    const html = `
      <script type="application/ld+json">{not valid json</script>
      <title>Fallback Title</title>
    `;
    const result = extractMetadataFromHtml(html);
    expect(result).toContain('Title: Fallback Title');
    expect(result).not.toContain('Structured data:');
  });

  it('skips oversized JSON-LD blocks (>3000 chars)', () => {
    const bigJson = JSON.stringify({ data: 'x'.repeat(3000) });
    const html = `<script type="application/ld+json">${bigJson}</script>`;
    expect(extractMetadataFromHtml(html)).not.toContain('Structured data:');
  });

  it('returns empty string when no metadata is found', () => {
    expect(extractMetadataFromHtml('<html><body>Hello</body></html>')).toBe('');
  });
});

describe('extractTextFromHtml', () => {
  it('strips script tags and content', () => {
    const html = '<p>Hello</p><script>var x = 1;</script><p>World</p>';
    expect(extractTextFromHtml(html)).toBe('Hello World');
  });

  it('strips style tags and content', () => {
    const html = '<p>Hello</p><style>.x { color: red; }</style><p>World</p>';
    expect(extractTextFromHtml(html)).toBe('Hello World');
  });

  it('strips noscript tags and content', () => {
    const html =
      '<p>Hello</p><noscript>Enable JS please</noscript><p>World</p>';
    expect(extractTextFromHtml(html)).toBe('Hello World');
  });

  it('decodes HTML entities', () => {
    const html =
      '<p>Tom &amp; Jerry &lt;3&gt; &quot;friends&quot; &#39;yeah&#39;</p>';
    const result = extractTextFromHtml(html);
    expect(result).toContain('Tom & Jerry');
    expect(result).toContain('"friends"');
    expect(result).toContain("'yeah'");
  });

  it('collapses whitespace', () => {
    const html = '<p>  Hello   World  </p>';
    expect(extractTextFromHtml(html)).toBe('Hello World');
  });

  it('prepends metadata when body text is sparse (<200 chars)', () => {
    const html =
      '<html><head><title>My Clinic</title></head><body><p>Hi</p></body></html>';
    const result = extractTextFromHtml(html);
    expect(result).toContain('Title: My Clinic');
    expect(result).toContain('Hi');
  });

  it('does not prepend metadata when body text is sufficient', () => {
    const longText = 'A'.repeat(300);
    const html = `<html><head><title>My Clinic</title></head><body><p>${longText}</p></body></html>`;
    const result = extractTextFromHtml(html);
    expect(result).not.toContain('Title:');
    expect(result).toContain(longText);
  });

  it('limits output to 15000 characters', () => {
    const longText = 'A'.repeat(20000);
    const html = `<p>${longText}</p>`;
    expect(extractTextFromHtml(html).length).toBeLessThanOrEqual(15000);
  });

  it('returns empty string for empty HTML', () => {
    expect(extractTextFromHtml('')).toBe('');
  });

  it('handles malformed HTML gracefully', () => {
    const html = '<p>Unclosed <div>tags <b>everywhere';
    const result = extractTextFromHtml(html);
    expect(result).toContain('Unclosed');
    expect(result).toContain('tags');
    expect(result).toContain('everywhere');
  });
});
