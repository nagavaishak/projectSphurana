import { chatCompletion } from '@borradh-workspace/ai';
import { z } from 'zod';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import type {
  ExtractedDocument,
  LeadCandidate,
  MatchDecision,
} from '../../models/index.js';

const MODEL_TIMEOUT_MS = 30_000;

export const ADJUDICATE_SYSTEM_PROMPT = `You match a document to ONE client record in a beauty / aesthetics clinic's client system.

You are given what was read from the document, and a short list of candidate clients found by name, email or phone. Decide which single candidate the document is about.

Respond with JSON only:
{ "leadId": the chosen candidate's leadId, or null, "confidence": number from 0 to 1, "reason": at most 25 words }

How to weigh it:
- A shared email or phone number is strong evidence.
- A name is enough on its own when it fits ONE candidate and no other. Most clinical paperwork carries a name and nothing else; do not hold missing contact details against a candidate the name clearly identifies.
- Names are transcribed by hand, so treat these as the same name: accents dropped ("Súilleabháin" / "Suilleabhain"), apostrophes and hyphens moved or missing ("O'Brien" / "O Brien" / "OBrien"), an initial standing in for a first name ("B. Fitzgerald" is Bartholomew Fitzgerald), and a shortened form of a first name ("Kate" for "Katherine").
- Be careful where it is genuinely ambiguous: if the name fits two candidates equally, or two candidates are duplicates of each other, → leadId null.
- If no candidate fits → leadId null with a low confidence.
- leadId MUST be one of the candidates' ids exactly as given; never invent one.`;

const decisionSchema = z.object({
  leadId: z.string().nullable().catch(null),
  confidence: z.number().min(0).max(1).catch(0),
  reason: z.string().trim().max(300).catch(''),
});

const maskEmail = (email: string | null): string | null => {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!domain) return email;
  return `${local.slice(0, 2)}…@${domain}`;
};

const maskPhone = (phone: string | null): string | null => {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `…${digits.slice(-4)}` : null;
};

export const buildAdjudicateUserPrompt = (
  fileName: string,
  extracted: ExtractedDocument,
  candidates: LeadCandidate[]
): string => {
  const doc = {
    fileName,
    documentKind: extracted.documentKind,
    personName: extracted.personName,
    email: extracted.email,
    phone: extracted.phone,
    dateOfBirth: extracted.dateOfBirth,
    dates: extracted.dates,
    summary: extracted.summary,
  };
  const list = candidates.map((c) => ({
    leadId: c.leadId,
    name: c.name,
    email: maskEmail(c.email),
    phone: maskPhone(c.phone),
    matchedOn: c.matchedOn,
    recentAppointments: c.lastAppointments,
  }));
  return `Read from the document:\n${JSON.stringify(doc, null, 2)}\n\nCandidates:\n${JSON.stringify(list, null, 2)}\n\nReturn the JSON.`;
};

export interface AdjudicateDocumentMatchInput {
  organizationId: string;
  importId: string;
  fileName: string;
  extracted: ExtractedDocument;
  candidates: LeadCandidate[];
}

/**
 * Ask gpt-5.6-luna to pick among the deterministic candidates (ENG-784).
 * Text-only — the document has already been read. The chosen id is checked
 * against the candidate set; anything else is treated as "no pick".
 */
export const adjudicateDocumentMatch = async (
  input: AdjudicateDocumentMatchInput
): Promise<Result<MatchDecision>> => {
  if (input.candidates.length === 0) {
    return ok({ leadId: null, confidence: 0, reason: 'No candidates' });
  }

  let content: string;
  try {
    const res = await chatCompletion(
      buildAdjudicateUserPrompt(
        input.fileName,
        input.extracted,
        input.candidates
      ),
      {
        systemMessage: ADJUDICATE_SYSTEM_PROMPT,
        jsonResponse: true,
        maxTokens: 300,
        reasoningEffort: 'low',
        timeoutMs: MODEL_TIMEOUT_MS,
        maxRetries: 1,
        observability: {
          spanName: 'documentImports.adjudicate',
          distinctId: input.organizationId,
          groups: { organization: input.organizationId },
          properties: {
            organizationId: input.organizationId,
            importId: input.importId,
            candidates: input.candidates.length,
          },
        },
      }
    );
    content = res.content;
  } catch (error) {
    return err(
      new FeatureError(
        ErrorCodes.EXTERNAL_SERVICE_ERROR,
        `Document matcher unavailable: ${error instanceof Error ? error.message : String(error)}`
      )
    );
  }

  let raw: unknown;
  try {
    const trimmed = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    raw = JSON.parse(
      trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)
    );
  } catch {
    return ok({
      leadId: null,
      confidence: 0,
      reason: 'The matcher returned no usable answer',
    });
  }
  const decision = decisionSchema.parse(raw);
  const known = new Set(input.candidates.map((c) => c.leadId));
  if (decision.leadId && !known.has(decision.leadId)) {
    return ok({
      leadId: null,
      confidence: 0,
      reason: 'The matcher named a client that was not a candidate',
    });
  }
  return ok(decision);
};
