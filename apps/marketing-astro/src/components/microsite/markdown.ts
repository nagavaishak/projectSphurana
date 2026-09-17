/**
 * A deliberately tiny markdown subset for `rich_text`.
 *
 * NOT a markdown library. No markdown parser in this repo is a direct
 * dependency of marketing-astro (Astro's own remark pipeline only runs over
 * `.md` files at build time, not over runtime strings), and pulling one in
 * would drag a sanitizer with it. `rich_text` is agent-authored copy — the
 * only markdown it needs is headings, emphasis, links and lists.
 *
 * SECURITY BOUNDARY: input is escaped FIRST, then a fixed set of inline
 * patterns is re-expanded into tags. There is no raw-HTML passthrough by
 * construction — an author cannot smuggle a tag through, because by the time
 * any pattern runs, every `<` is already `&lt;`. Raw HTML is the `custom_html`
 * block, a later phase.
 */

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Link hrefs get their own allowlist: `javascript:` and `data:` are the whole
 * reason link rendering is dangerous, and escaping does not stop them.
 */
const safeHref = (raw: string): string | null => {
  const href = raw.trim();
  if (!href) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(href)) return href;
  // Site-relative paths, but not protocol-relative `//evil.com`.
  if (/^\/(?!\/)/.test(href) || /^#[\w-]/.test(href)) return href;
  return null;
};

/** Inline patterns, applied to ALREADY-ESCAPED text. */
const inline = (escaped: string): string =>
  escaped
    // [text](href)
    .replace(
      /\[([^\]\n]+)\]\(([^)\s]+)\)/g,
      (_match: string, text: string, href: string) => {
        const safe = safeHref(href.replace(/&amp;/g, '&'));
        if (!safe) return text;
        const external = /^https?:\/\//i.test(safe);
        const rel = external
          ? ' rel="noopener noreferrer" target="_blank"'
          : '';
        return `<a href="${escapeHtml(safe)}"${rel}>${text}</a>`;
      }
    )
    // **bold** then *italic* / _italic_
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>');

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const UL_RE = /^[-*]\s+(.*)$/;
const OL_RE = /^\d+\.\s+(.*)$/;

/**
 * Render the subset: headings, paragraphs, bold, italic, links, and unordered
 * / ordered lists. Everything else degrades to paragraph text — a block of
 * unsupported syntax must still read, not vanish.
 */
export const renderMarkdownSubset = (markdown: unknown): string => {
  if (typeof markdown !== 'string' || !markdown.trim()) return '';

  const lines = escapeHtml(markdown.replace(/\r\n?/g, '\n')).split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${inline(paragraph.join('<br />'))}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((i) => `<li>${inline(i)}</li>`).join('');
    out.push(`<${list.tag}>${items}</${list.tag}>`);
    list = null;
  };
  const flush = () => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flush();
      continue;
    }

    const heading = HEADING_RE.exec(trimmed);
    if (heading) {
      flush();
      // Author headings start at h2 — h1 is the page title, and letting a
      // block mint a second h1 wrecks the document outline for SEO.
      const level = Math.min(6, heading[1].length + 1);
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const ul = UL_RE.exec(trimmed);
    const ol = ul ? null : OL_RE.exec(trimmed);
    const listMatch = ul ?? ol;
    if (listMatch) {
      flushParagraph();
      const tag = ul ? 'ul' : 'ol';
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push(listMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }

  flush();
  return out.join('');
};
