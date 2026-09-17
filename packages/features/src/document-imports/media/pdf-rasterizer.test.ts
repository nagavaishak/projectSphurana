import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Stand-in for pdfjs that behaves like the real thing in the one way that
 * matters here: `getDocument` takes ownership of `data` and TRANSFERS it to
 * its worker, detaching the underlying ArrayBuffer.
 *
 * Real pdfjs only transfers above a size threshold, which is precisely why
 * this bug survived every synthetic fixture and only showed up on a 766KB
 * phone scan. Detaching unconditionally here makes the regression
 * deterministic instead of size-dependent.
 */
const seenData: Uint8Array[] = [];

const getDocument = vi.fn((options: { data: Uint8Array }) => {
  seenData.push(options.data);
  // structuredClone with a transfer list is how the real worker takes it.
  structuredClone(options.data.buffer, { transfer: [options.data.buffer] });
  return {
    promise: Promise.resolve({
      numPages: 1,
      canvasFactory: {
        create: () => ({
          canvas: { toBuffer: () => Buffer.from([1, 2, 3]) },
          context: {},
        }),
        destroy: () => undefined,
      },
      getPage: () =>
        Promise.resolve({
          getTextContent: () => Promise.resolve({ items: [] }),
          getViewport: () => ({ width: 10, height: 10 }),
          render: () => ({ promise: Promise.resolve() }),
          cleanup: () => undefined,
        }),
    }),
    destroy: () => Promise.resolve(),
  };
});

vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ getDocument }));

import { extractPdfText, renderPdfPages } from './pdf-rasterizer.js';

const somePdfBytes = () => Buffer.alloc(2048, 7);

describe('pdf-rasterizer', () => {
  beforeEach(() => {
    seenData.length = 0;
    getDocument.mockClear();
  });

  /**
   * The regression this file exists for.
   *
   * `openPdf` used to hand pdfjs `new Uint8Array(bytes.buffer, …)` — a window
   * onto the CALLER's Buffer rather than a copy. pdfjs detached it, so the
   * first read consumed the caller's bytes and anything downstream died with
   * "Cannot perform Construct on a detached ArrayBuffer".
   *
   * That is the scan path end to end: a PDF with no text layer extracts zero
   * characters and then falls through to rasterising, so every phone-scanned
   * consent form — the importer's whole reason to exist — failed outright.
   */
  it('leaves the caller’s buffer intact for a second read', async () => {
    const bytes = somePdfBytes();

    await extractPdfText(bytes, 1);

    expect(bytes.buffer.byteLength).toBeGreaterThan(0);
    expect(bytes.length).toBe(2048);
  });

  it('reads text then rasterises the SAME buffer — the no-text-layer path', async () => {
    const bytes = somePdfBytes();

    const text = await extractPdfText(bytes, 1);
    expect(text).toBe('');

    // Pre-fix this threw "Cannot perform Construct on a detached ArrayBuffer".
    await expect(
      renderPdfPages(bytes, { maxPages: 1, scale: 2 })
    ).resolves.toHaveLength(1);
  });

  it('never hands pdfjs a view onto the caller’s buffer', async () => {
    const bytes = somePdfBytes();

    await extractPdfText(bytes, 1);

    expect(seenData).toHaveLength(1);
    expect(seenData[0].buffer).not.toBe(bytes.buffer);
  });
});
