import {
  type ChatCompletionOptions,
  type ImageInput,
  chatCompletion,
  visionCompletion,
} from '@borradh-workspace/ai';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type {
  DocumentMediaDeps,
  ExtractedDocument,
} from '../../models/index.js';
import {
  type ExtractDocumentFieldsInput,
  extractedDocumentSchema,
} from './extract-document-fields.schema.js';
import { EXTRACT_SYSTEM_PROMPT, buildExtractUserPrompt } from './prompts.js';

/** Pages beyond this rarely carry the client's identity. */
const MAX_PAGES = 3;
/** 1.5× of 72dpi ≈ 108dpi — form text is readable, request stays small. */
const RENDER_SCALE = 1.5;
/**
 * A PDF with at least this much extractable text is sent as text — cheaper,
 * faster, and no canvas work. Below it we assume a scan and rasterise.
 */
const MIN_TEXT_CHARS = 200;

const MODEL_TIMEOUT_MS = 60_000;

/**
 * Pull the model's JSON out of a reply that may be fenced. Done locally
 * rather than via the shared `parseJsonResponse` so the parse is plain code
 * the tests never have to stub.
 */
export const parseExtractedDocument = (
  content: string
): ExtractedDocument | null => {
  const trimmed = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return null;
  }
  const parsed = extractedDocumentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

const modelOptions = (
  input: ExtractDocumentFieldsInput
): ChatCompletionOptions => ({
  systemMessage: EXTRACT_SYSTEM_PROMPT,
  jsonResponse: true,
  maxTokens: 700,
  reasoningEffort: 'low',
  timeoutMs: MODEL_TIMEOUT_MS,
  // The worker owns retry policy (BullMQ attempts); SDK retries on top would
  // outlive the job lock.
  maxRetries: 1,
  observability: {
    spanName: 'documentImports.extract',
    distinctId: input.organizationId,
    groups: { organization: input.organizationId },
    properties: {
      organizationId: input.organizationId,
      importId: input.importId,
      mimeType: input.mimeType,
    },
  },
});

/**
 * Read one staged document with gpt-5.6-luna and return who it is about
 * (ENG-784).
 *
 *   PDF                    → pages rasterised → vision, with the text layer
 *                            alongside it when there is one
 *   PDF that won't render  → text-only chat completion, if it has text
 *   photo                  → downscaled → vision completion
 *
 * Error codes carry the retry decision for the worker: EXTERNAL_SERVICE_ERROR
 * (model/network) is worth a second attempt; VALIDATION_ERROR (unreadable
 * file, no usable reply) is not.
 */
export const extractDocumentFields = async (
  media: DocumentMediaDeps,
  input: ExtractDocumentFieldsInput
): Promise<Result<ExtractedDocument>> => {
  let content: string;
  try {
    if (input.mimeType === 'application/pdf') {
      const text = await media.extractPdfText(input.bytes, MAX_PAGES);

      // LOOK at the pages, whatever the text layer said. A text layer covers
      // the typed parts of a form and nothing else — not the ID photo pasted
      // into it, not the handwriting in the blanks, not the signature, not a
      // scan someone appended. Reading only the text meant those documents
      // were judged on the boilerplate around the very thing that identifies
      // the client.
      let images: ImageInput[] = [];
      try {
        const pages = await media.renderPdfPages(input.bytes, {
          maxPages: MAX_PAGES,
          scale: RENDER_SCALE,
        });
        images = pages.map((page) => ({
          base64: page.toString('base64'),
          mimeType: 'image/jpeg',
        }));
      } catch (renderError) {
        // A PDF that will not rasterise but did give up its text is still
        // perfectly readable — fall through to text. With no text either,
        // there is nothing left to try, so let it surface.
        if (text.length < MIN_TEXT_CHARS) throw renderError;
      }

      if (images.length === 0) {
        if (text.length < MIN_TEXT_CHARS) {
          return err(
            new FeatureError(
              ErrorCodes.VALIDATION_ERROR,
              'Could not read any pages from the PDF'
            )
          );
        }
        const res = await chatCompletion(
          buildExtractUserPrompt(input.fileName, text),
          modelOptions(input)
        );
        content = res.content;
      } else {
        const res = await visionCompletion(
          buildExtractUserPrompt(input.fileName, text || null, true),
          images,
          { ...modelOptions(input), detail: 'high' }
        );
        content = res.content;
      }
    } else {
      const prepared = await media.prepareImage(input.bytes, input.mimeType);
      const res = await visionCompletion(
        buildExtractUserPrompt(input.fileName, null, true),
        [prepared],
        { ...modelOptions(input), detail: 'high' }
      );
      content = res.content;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Decoding failures are the file's fault; anything else is the model's.
    const isMediaError = /pdf|image|decode|canvas|sharp|corrupt|invalid/i.test(
      message
    );
    return err(
      new FeatureError(
        isMediaError
          ? ErrorCodes.VALIDATION_ERROR
          : ErrorCodes.EXTERNAL_SERVICE_ERROR,
        isMediaError
          ? `Could not read the file: ${message}`
          : `Document reader unavailable: ${message}`
      )
    );
  }

  const extracted = parseExtractedDocument(content);
  if (!extracted) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        'The document reader returned no usable answer'
      )
    );
  }
  return ok(extracted);
};
