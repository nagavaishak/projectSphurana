import { describe, expect, it } from '@borradh-workspace/testing';
import {
  extractColorsFromHtml,
  extractLogoFromHtml,
} from './extract-visual-assets.js';

describe('extractColorsFromHtml', () => {
  it('extracts CSS variable hex colors', () => {
    const html =
      '<style>:root { --primary: #ff6b35; --accent: #2ec4b6; }</style>';
    const result = extractColorsFromHtml(html);
    expect(result).toContain('#ff6b35');
    expect(result).toContain('#2ec4b6');
  });

  it('extracts theme-color meta tag', () => {
    const html = '<meta name="theme-color" content="#4a90d9">';
    expect(extractColorsFromHtml(html)).toContain('#4a90d9');
  });

  it('extracts colors from background-color property', () => {
    const html = '<div style="background-color: #e74c3c">Red</div>';
    expect(extractColorsFromHtml(html)).toContain('#e74c3c');
  });

  it('extracts colors from background shorthand', () => {
    const html = '<style>.btn { background: #3498db; }</style>';
    expect(extractColorsFromHtml(html)).toContain('#3498db');
  });

  it('extracts colors from color property', () => {
    const html = '<style>h1 { color: #2c3e50; }</style>';
    expect(extractColorsFromHtml(html)).toContain('#2c3e50');
  });

  it('extracts colors from border-color property', () => {
    const html = '<style>.box { border-color: #9b59b6; }</style>';
    expect(extractColorsFromHtml(html)).toContain('#9b59b6');
  });

  it('filters out common non-brand colors (black, white, grays)', () => {
    const html = `
      <style>
        body { color: #333333; background: #ffffff; }
        .brand { color: #e74c3c; }
      </style>
    `;
    const result = extractColorsFromHtml(html);
    expect(result).toContain('#e74c3c');
    expect(result).not.toContain('#333333');
    expect(result).not.toContain('#ffffff');
  });

  it('filters out shorthand grays', () => {
    const html = '<style>:root { --gray: #ccc; --brand: #a0522d; }</style>';
    const result = extractColorsFromHtml(html);
    expect(result).not.toContain('#ccc');
    expect(result).toContain('#a0522d');
  });

  it('normalizes colors to lowercase', () => {
    const html = '<meta name="theme-color" content="#FF6B35">';
    expect(extractColorsFromHtml(html)).toContain('#ff6b35');
  });

  it('handles 3-digit hex codes', () => {
    const html = '<style>.x { color: #f80; }</style>';
    expect(extractColorsFromHtml(html)).toContain('#f80');
  });

  it('deduplicates colors', () => {
    const html = `
      <style>
        .a { color: #ff6b35; }
        .b { background: #ff6b35; }
      </style>
    `;
    const result = extractColorsFromHtml(html);
    const count = result.filter((c) => c === '#ff6b35').length;
    expect(count).toBe(1);
  });

  it('returns empty array when no colors found', () => {
    expect(extractColorsFromHtml('<p>No colors here</p>')).toEqual([]);
  });

  it('returns empty array when only non-brand colors present', () => {
    const html = '<style>body { color: #000; background: #fff; }</style>';
    expect(extractColorsFromHtml(html)).toEqual([]);
  });
});

describe('extractLogoFromHtml', () => {
  const base = 'https://example.com';

  it('extracts og:image', () => {
    const html =
      '<meta property="og:image" content="https://example.com/logo.png">';
    expect(extractLogoFromHtml(html, base)).toBe(
      'https://example.com/logo.png'
    );
  });

  it('extracts twitter:image', () => {
    const html =
      '<meta name="twitter:image" content="https://example.com/twitter.png">';
    expect(extractLogoFromHtml(html, base)).toBe(
      'https://example.com/twitter.png'
    );
  });

  it('prefers og:image over twitter:image', () => {
    const html = `
      <meta property="og:image" content="https://example.com/og.png">
      <meta name="twitter:image" content="https://example.com/tw.png">
    `;
    expect(extractLogoFromHtml(html, base)).toBe('https://example.com/og.png');
  });

  it('extracts logo from img with logo class', () => {
    const html = '<img class="site-logo" src="/img/logo.svg">';
    expect(extractLogoFromHtml(html, base)).toBe(
      'https://example.com/img/logo.svg'
    );
  });

  it('extracts logo from img with logo in src', () => {
    const html = '<img src="/assets/company-logo.png" alt="Company">';
    expect(extractLogoFromHtml(html, base)).toBe(
      'https://example.com/assets/company-logo.png'
    );
  });

  it('extracts logo from img with logo in alt text', () => {
    const html = '<img alt="Company Logo" src="/brand.png">';
    expect(extractLogoFromHtml(html, base)).toBe(
      'https://example.com/brand.png'
    );
  });

  it('extracts favicon as fallback', () => {
    const html = '<link rel="icon" href="/favicon.ico">';
    expect(extractLogoFromHtml(html, base)).toBe(
      'https://example.com/favicon.ico'
    );
  });

  it('resolves relative URLs against base', () => {
    const html = '<meta property="og:image" content="/images/logo.png">';
    expect(extractLogoFromHtml(html, base)).toBe(
      'https://example.com/images/logo.png'
    );
  });

  it('returns null when no logo found', () => {
    expect(extractLogoFromHtml('<p>No images</p>', base)).toBeNull();
  });
});
