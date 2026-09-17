import {
  type ConsentFormSubmission,
  consentFormSubmission,
  organization,
  withSystemScope,
} from '@borradh-workspace/database';
import { logError, trackedResult } from '@borradh-workspace/observability';
import {
  downloadAsBuffer,
  getOrgAssetsBucket,
  getPublicAssetsBucket,
  parseS3Url,
  upload,
} from '@borradh-workspace/storage';
import { and, eq } from 'drizzle-orm';
import {
  PDFDocument,
  type PDFFont,
  type PDFImage,
  type PDFPage,
  StandardFonts,
  rgb,
} from 'pdf-lib';
import {
  type DbConnection,
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type GenerateConsentPdfInput,
  generateConsentPdfSchema,
} from './generate-consent-pdf.schema.js';
import {
  createPageCursor,
  fitImage,
  formatSignedAt,
  interpolatePatientName,
  sanitizePdfText,
  wrapMultiline,
  wrapParagraph,
} from './pdf-layout.js';

// A4 in PDF points.
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const INK = rgb(0.13, 0.13, 0.13);
const MUTED = rgb(0.45, 0.45, 0.45);
const RULE = rgb(0.85, 0.85, 0.85);

interface OrgForPdf {
  id: string;
  name: string;
  logo: string | null;
  timezone: string;
}

/**
 * Is this one of OUR buckets?
 *
 * The allowlist is deliberately the two buckets a logo can legitimately live
 * in. Compared by exact name, not prefix or substring — `borradh-org-assets`
 * must not vouch for `borradh-org-assets-evil`.
 *
 * NOTE: `image-generation/logo-variants.ts` trusts `parseS3Url(org.logo)` the
 * same way this used to, and additionally UPLOADS back to the parsed bucket.
 * That predates ENG-647 and is tracked separately; fixing it here would be
 * out of scope for a consent-PDF change.
 */
function isOwnBucket(bucket: string): boolean {
  return bucket === getOrgAssetsBucket() || bucket === getPublicAssetsBucket();
}

/**
 * Resolve the org logo to embeddable bytes.
 *
 * `organization.logo` is free text validated only as a URL, so it is treated
 * as UNTRUSTED here: an S3 URL is accepted only for our own buckets, a bare
 * value is read as a key from org-assets, and an arbitrary http(s) host is
 * refused outright. Any failure — refused host, network, decode, unsupported
 * format — skips the logo cleanly and the PDF still renders.
 */
async function tryLoadLogoBytes(logo: string | null): Promise<Buffer | null> {
  if (!logo) return null;
  try {
    const s3 = parseS3Url(logo);
    if (s3) {
      // Only OUR buckets. `organization.logo` is free text validated as a URL
      // and nothing more, and `parseS3Url` happily parses any
      // `*.s3.*.amazonaws.com` host — so without this an org admin could point
      // it at another tenant's object and read those bytes out of the consent
      // PDF, using the task role's own credentials.
      if (!isOwnBucket(s3.bucket)) return null;
      return await downloadAsBuffer({ bucket: s3.bucket, key: s3.key });
    }
    if (/^https?:\/\//.test(logo)) {
      // No bare fetch of an org-supplied URL. It runs from inside the Fly
      // private network, so an arbitrary host is blind SSRF, and
      // `arrayBuffer()` buffers the whole response with no cap. Logos live in
      // our own buckets; anything else is not a logo we should be fetching.
      return null;
    }
    return await downloadAsBuffer({ bucket: getOrgAssetsBucket(), key: logo });
  } catch {
    return null;
  }
}

/** Embed image bytes by sniffing the magic number; null when unsupported. */
async function tryEmbedImage(
  doc: PDFDocument,
  bytes: Buffer
): Promise<PDFImage | null> {
  try {
    if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50) {
      return await doc.embedPng(bytes);
    }
    if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
      return await doc.embedJpg(bytes);
    }
    return null;
  } catch {
    return null;
  }
}

function checkboxAnswer(value: unknown): string {
  return value === true ? 'Yes' : 'No';
}

function textAnswer(value: unknown): string {
  return typeof value === 'string' && value.trim() !== '' ? value : '-';
}

/** Compose the full A4 document. Exposed for the smoke test. */
export async function composeConsentPdf(options: {
  submission: ConsentFormSubmission;
  org: OrgForPdf;
  logoBytes: Buffer | null;
  signatureBytes: Buffer | null;
}): Promise<Uint8Array> {
  const { submission, org, logoBytes, signatureBytes } = options;
  const snapshot = submission.templateSnapshot;

  // The archived PDF must read identically to what the patient attested to —
  // never with a raw {{patientName}} token (see interpolatePatientName).
  const title = interpolatePatientName(snapshot.title, submission.signedByName);
  const bodyText = interpolatePatientName(
    snapshot.body,
    submission.signedByName
  );

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  const pages: PDFPage[] = [];
  const pageAt = (index: number): PDFPage => {
    while (pages.length <= index) {
      pages.push(doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]));
    }
    return pages[index];
  };

  const cursor = createPageCursor({
    pageHeight: PAGE_HEIGHT,
    marginTop: MARGIN,
    marginBottom: MARGIN,
  });

  const drawLine = (
    text: string,
    options_: { font: PDFFont; size: number; color?: ReturnType<typeof rgb> }
  ) => {
    const lineHeight = options_.size * 1.35;
    const at = cursor.take(lineHeight);
    pageAt(at.pageIndex).drawText(text, {
      x: MARGIN,
      y: at.y - options_.size,
      size: options_.size,
      font: options_.font,
      color: options_.color ?? INK,
    });
  };

  const drawWrapped = (
    text: string,
    options_: { font: PDFFont; size: number; color?: ReturnType<typeof rgb> }
  ) => {
    const lines = wrapMultiline(sanitizePdfText(text), CONTENT_WIDTH, (s) =>
      options_.font.widthOfTextAtSize(s, options_.size)
    );
    for (const line of lines) {
      if (line === '') {
        cursor.gap(options_.size * 0.9);
      } else {
        drawLine(line, options_);
      }
    }
  };

  const drawRule = () => {
    const at = cursor.take(1);
    pageAt(at.pageIndex).drawLine({
      start: { x: MARGIN, y: at.y },
      end: { x: PAGE_WIDTH - MARGIN, y: at.y },
      thickness: 1,
      color: RULE,
    });
  };

  // ── Header: logo (when embeddable) + clinic name ─────────────────────────
  const logoImage = logoBytes ? await tryEmbedImage(doc, logoBytes) : null;
  const orgName = sanitizePdfText(org.name) || 'Clinic';
  if (logoImage) {
    const size = fitImage(logoImage.width, logoImage.height, 120, 40);
    const at = cursor.take(Math.max(size.height, 18));
    pageAt(at.pageIndex).drawImage(logoImage, {
      x: MARGIN,
      y: at.y - size.height,
      width: size.width,
      height: size.height,
    });
    pageAt(at.pageIndex).drawText(orgName, {
      x: MARGIN + size.width + 12,
      y: at.y - size.height / 2 - 5,
      size: 14,
      font: bold,
      color: INK,
    });
  } else {
    drawLine(orgName, { font: bold, size: 14 });
  }

  cursor.gap(14);
  drawRule();
  cursor.gap(20);

  // ── Title + body ─────────────────────────────────────────────────────────
  const titleLines = wrapParagraph(sanitizePdfText(title), CONTENT_WIDTH, (s) =>
    bold.widthOfTextAtSize(s, 16)
  );
  for (const line of titleLines) drawLine(line, { font: bold, size: 16 });
  cursor.gap(12);
  drawWrapped(bodyText, { font, size: 11 });

  // ── Fields: bold label, regular answer ───────────────────────────────────
  if (snapshot.fields.length > 0) {
    cursor.gap(16);
    for (const field of snapshot.fields) {
      const value = submission.fieldData[field.label];
      const answer =
        field.type === 'checkbox' ? checkboxAnswer(value) : textAnswer(value);
      drawWrapped(field.label, { font: bold, size: 11 });
      drawWrapped(answer, { font, size: 11 });
      cursor.gap(6);
    }
  }

  // ── Footer: rule, signed-by, signed-at, drawn signature ──────────────────
  cursor.gap(20);
  drawRule();
  cursor.gap(14);

  if (submission.signedByName) {
    drawLine(`Signed by ${sanitizePdfText(submission.signedByName)}`, {
      font: bold,
      size: 11,
    });
  }
  if (submission.signedAt) {
    drawLine(`Signed at ${formatSignedAt(submission.signedAt, org.timezone)}`, {
      font,
      size: 10,
      color: MUTED,
    });
  }

  const signatureImage = signatureBytes
    ? await tryEmbedImage(doc, signatureBytes)
    : null;
  if (signatureImage) {
    cursor.gap(8);
    const size = fitImage(signatureImage.width, signatureImage.height, 180, 60);
    const at = cursor.take(size.height);
    pageAt(at.pageIndex).drawImage(signatureImage, {
      x: MARGIN,
      y: at.y - size.height,
      width: size.width,
      height: size.height,
    });
  }

  // A document with no drawable content would otherwise have zero pages.
  pageAt(0);

  return doc.save();
}

const generateConsentPdfImpl = async (
  db: DbConnection,
  input: GenerateConsentPdfInput
): Promise<Result<{ pdfKey: string }>> => {
  const parsed = generateConsentPdfSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }

  const { submissionId, organizationId } = parsed.data;

  try {
    // System scope: callers (the sign service, the download services) have
    // already proven the caller may see this submission.
    const loaded = await withSystemScope(
      async (conn) => {
        const submission = await conn.query.consentFormSubmission.findFirst({
          where: and(
            eq(consentFormSubmission.id, submissionId),
            eq(consentFormSubmission.organizationId, organizationId)
          ),
        });
        if (!submission) return { submission: null, org: null };
        const org = await conn.query.organization.findFirst({
          where: eq(organization.id, organizationId),
        });
        return { submission, org };
      },
      { db }
    );

    const { submission, org } = loaded;
    if (!submission) {
      return err(
        new FeatureError(ErrorCodes.NOT_FOUND, 'Consent form not found')
      );
    }
    if (submission.status !== 'completed') {
      return err(
        new FeatureError(
          ErrorCodes.CONFLICT,
          'This consent form has not been signed yet'
        )
      );
    }
    if (!org) {
      return err(new FeatureError(ErrorCodes.NOT_FOUND, 'Clinic not found'));
    }

    const bucket = getOrgAssetsBucket();

    const [logoBytes, signatureBytes] = await Promise.all([
      tryLoadLogoBytes(org.logo),
      submission.signatureImageKey
        ? downloadAsBuffer({
            bucket,
            key: submission.signatureImageKey,
          }).catch(() => null)
        : Promise.resolve(null),
    ]);

    const pdfBytes = await composeConsentPdf({
      submission,
      org: {
        id: org.id,
        name: org.name,
        logo: org.logo,
        timezone: org.timezone,
      },
      logoBytes,
      signatureBytes,
    });

    const pdfKey = `consent-pdfs/${organizationId}/${submission.leadId}/${submissionId}.pdf`;
    await upload({
      bucket,
      key: pdfKey,
      body: Buffer.from(pdfBytes),
      contentType: 'application/pdf',
    });

    await withSystemScope(
      (conn) =>
        conn
          .update(consentFormSubmission)
          .set({ pdfKey })
          .where(
            and(
              eq(consentFormSubmission.id, submissionId),
              eq(consentFormSubmission.organizationId, organizationId)
            )
          ),
      { db }
    );

    return ok({ pdfKey });
  } catch (error) {
    logError('consentForms.generateConsentPdf', error, {
      feature: 'consent-forms',
      extra: { submissionId, organizationId },
    });
    return err(
      new FeatureError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to generate the consent form PDF'
      )
    );
  }
};

/**
 * Compose + store the signed-form PDF (A4: clinic header, full form copy,
 * field answers, signature footer). Saves `pdf_key` on the submission.
 * Callers are responsible for authorising access to the submission first.
 */
export const generateConsentPdf = (
  db: DbConnection,
  input: GenerateConsentPdfInput
) =>
  trackedResult(
    'consentForms.generateConsentPdf',
    () => generateConsentPdfImpl(db, input),
    {
      properties: {
        submissionId: input.submissionId,
        organizationId: input.organizationId,
      },
    }
  );

export type GenerateConsentPdfResult = Awaited<
  ReturnType<typeof generateConsentPdf>
>;
