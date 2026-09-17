import { createRequire } from 'node:module';
import path from 'node:path';
import type { DocumentMediaDeps } from '../models/index.js';

/**
 * PDF reading for the document matcher — text layer first, pixels second.
 *
 * Everything heavy is loaded LAZILY and only from here:
 *   - `pdfjs-dist` is ESM-only and `apps/api` compiles to CommonJS. A static
 *     import would drag it through the api's `require(esm)` path at module
 *     load; a dynamic import inside the function keeps it out of every import
 *     graph (including vitest's) until a job actually needs it.
 *   - pdfjs renders through `@napi-rs/canvas` (its own optional dependency,
 *     resolved with `require` from inside pdfjs) — a prebuilt, statically
 *     linked Skia, so it works on the distroless runtime image with no apt.
 *
 * `warmupDocumentRasterizer()` exists so the api's Docker smoke test — which
 * only catches MODULE_NOT_FOUND thrown during boot — actually exercises both
 * modules. The worker module calls it on init.
 */
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

type PdfLoadingTask = ReturnType<PdfJs['getDocument']>;
type PdfDocument = Awaited<PdfLoadingTask['promise']>;

interface OpenedPdf {
  doc: PdfDocument;
  /** pdfjs tears the document down through its loading task. */
  close(): Promise<void>;
}

interface NodeCanvasLike {
  toBuffer(mime: 'image/jpeg', quality?: number): Buffer;
}

interface CanvasFactoryLike {
  create(
    width: number,
    height: number
  ): { canvas: NodeCanvasLike; context: unknown };
  destroy(target: { canvas: NodeCanvasLike; context: unknown }): void;
}

let pdfjsPromise: Promise<PdfJs> | null = null;

const loadPdfJs = (): Promise<PdfJs> => {
  pdfjsPromise ??= import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
};

const require = createRequire(import.meta.url);

/** pdfjs needs the 14 standard fonts for PDFs that don't embed theirs. */
const standardFontDataUrl = (): string =>
  `${path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;

async function openPdf(bytes: Buffer): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    // COPY, never a view. pdfjs takes ownership of whatever `data` it is
    // handed and TRANSFERS it to its worker, which detaches the underlying
    // ArrayBuffer. Passing `new Uint8Array(bytes.buffer, …)` handed it a
    // window onto the caller's Buffer, so the first read consumed the
    // caller's bytes: `extractPdfText()` succeeded and every later use of the
    // same Buffer died with "Cannot perform Construct on a detached
    // ArrayBuffer".
    //
    // That is exactly the scan path. A PDF with no text layer — every
    // Microsoft Lens / phone-scanned consent form, which is most of what this
    // importer is for — extracts zero characters and then falls through to
    // `renderPdfPages()` on the now-detached buffer, so it could never be
    // read at all. Small fixtures hid it: pdfjs only transfers above a size
    // threshold, so synthetic one-page PDFs survived and real scans did not.
    data: new Uint8Array(bytes),
    standardFontDataUrl: standardFontDataUrl(),
    useSystemFonts: false,
    verbosity: 0,
  });
  const doc = await task.promise;
  return { doc, close: () => task.destroy() };
}

export async function extractPdfText(
  bytes: Buffer,
  maxPages: number
): Promise<string> {
  const { doc, close } = await openPdf(bytes);
  try {
    const pageCount = Math.min(doc.numPages, maxPages);
    const chunks: string[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items
          .map((item) => ('str' in item ? item.str : ''))
          .filter(Boolean)
          .join(' ');
        if (text.trim()) chunks.push(text);
      } finally {
        page.cleanup();
      }
    }
    return chunks
      .join('\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();
  } finally {
    await close();
  }
}

export async function renderPdfPages(
  bytes: Buffer,
  { maxPages, scale }: { maxPages: number; scale: number }
): Promise<Buffer[]> {
  const { doc, close } = await openPdf(bytes);
  try {
    const factory = doc.canvasFactory as CanvasFactoryLike;
    const pageCount = Math.min(doc.numPages, maxPages);
    const out: Buffer[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const target = factory.create(
        Math.ceil(viewport.width),
        Math.ceil(viewport.height)
      );
      try {
        await page.render({
          canvas: target.canvas as unknown as HTMLCanvasElement,
          canvasContext: target.context as CanvasRenderingContext2D,
          viewport,
        }).promise;
        out.push(target.canvas.toBuffer('image/jpeg', 80));
      } finally {
        factory.destroy(target);
        page.cleanup();
      }
    }
    return out;
  } finally {
    await close();
  }
}

/**
 * Load pdfjs, render one page through canvas, and load sharp — the three
 * native/ESM seams a stripped deploy bundle can break. Throws on the first
 * missing piece, which is the point.
 */
export async function warmupDocumentRasterizer(): Promise<void> {
  const { PDFDocument } = await import('pdf-lib');
  const probe = await PDFDocument.create();
  probe.addPage([24, 24]);
  const bytes = Buffer.from(await probe.save());
  const pages = await renderPdfPages(bytes, { maxPages: 1, scale: 1 });
  if (pages.length !== 1 || pages[0].length === 0) {
    throw new Error('Document rasterizer warmup produced no image');
  }
  await import('sharp');
}

export const pdfMediaDeps: Pick<
  DocumentMediaDeps,
  'extractPdfText' | 'renderPdfPages'
> = { extractPdfText, renderPdfPages };
