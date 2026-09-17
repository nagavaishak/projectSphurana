import { documentImportKindValues } from '@borradh-workspace/labels';

/**
 * Extraction prompt. The model's ONE job here is "who is this document
 * about" — matching happens deterministically afterwards, with the model
 * consulted again only when the candidates are ambiguous.
 */
export const EXTRACT_SYSTEM_PROMPT = `You read documents uploaded to a beauty / aesthetics clinic's client system and pull out who the document is about.

Documents are things like signed consent forms, intake or medical-history forms, ID scans (passport, driving licence), invoices and receipts, referral letters, treatment records, or photos of a client.

Identify the CLIENT (the patient / customer) the document concerns — never the clinic, the practitioner, the business, or a signatory acting for the clinic.

Respond with JSON only, exactly this shape:
{
  "documentKind": one of ${JSON.stringify(documentImportKindValues)},
  "personName": the client's full name as written, or null,
  "email": the client's email address, or null,
  "phone": the client's phone number as written, or null,
  "dateOfBirth": the client's date of birth as YYYY-MM-DD, or null,
  "dates": other dates visible on the document as YYYY-MM-DD strings (appointment, signature, invoice dates) — [] if none,
  "summary": what the document is, in at most 20 words,
  "legible": false only if the content cannot be read at all
}

Rules:
- Never invent a value. If a field is not on the document, use null.
- Copy names, emails and phone numbers exactly as written — do not correct spelling or reformat.
- If several people appear, choose the one the document is ABOUT (the client), not staff or witnesses.`;

/**
 * Three shapes, because a PDF can arrive with pages, text, or both — and when
 * both are present the model needs telling that the text is only the typed
 * layer, or it will answer from the boilerplate and ignore the handwriting
 * and photos it can see in the images.
 */
export const buildExtractUserPrompt = (
  fileName: string,
  text: string | null,
  hasImages = false
): string => {
  const header = `File name: ${fileName}`;
  const body = text?.trim()
    ? `\n\nExtracted text layer (first pages):\n"""\n${text.slice(0, 12_000)}\n"""`
    : '';

  if (hasImages && body) {
    return `${header}${body}\n\nThe pages are also attached as images. The text layer covers only what was typed — read the images for anything handwritten, signed, stamped, or photographed, and prefer what you can see there when the two disagree.\n\nReturn the JSON.`;
  }
  if (hasImages) {
    return `${header}\n\nThe document is attached as one or more page images. Read them and return the JSON.`;
  }
  return `${header}${body}\n\nReturn the JSON.`;
};
