import {
  chatCompletion,
  initAIClient,
  isAIClientInitialized,
} from '@borradh-workspace/ai';
import { apiEnv } from '@borradh-workspace/env/api';
import { logError, trackedResult } from '@borradh-workspace/observability';
import { z } from 'zod';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import {
  type NormalizeLeadInput,
  type NormalizedLeadFields,
  normalizeLeadSchema,
} from './normalize-lead.schema.js';

/**
 * Clean manually-typed lead fields into machine-readable form via GPT-4o:
 * phones to E.164, emails lowercased, names proper-cased.
 *
 * Best-effort by design — on any model failure it returns the ORIGINAL
 * fields, so lead creation is never blocked by the normalizer. Fields the
 * user didn't provide are never added.
 */

const aiFieldsSchema = z.object({
  firstName: z.string().trim().max(200).optional(),
  lastName: z.string().trim().max(200).optional(),
  email: z.string().trim().toLowerCase().email().optional(),
  phone: z.string().trim().max(30).optional(),
  whatsapp: z.string().trim().max(30).optional(),
});

const NORMALIZE_SYSTEM_MESSAGE = `You clean contact fields typed by hand into machine-readable form. Return JSON with the same keys you were given (omit keys you were not given):
- firstName, lastName: trimmed, proper-cased. Do not translate or invent.
- email: valid lowercase email. If it can't be a valid email, return it unchanged.
- phone, whatsapp: E.164 format (e.g. +353876846467). Infer the country code from the number's format when missing (Irish 08x → +353, UK 07x → +44, US 10-digit → +1). If it can't be a phone number, return it unchanged.
Never add information that isn't in the input. Output only the JSON object.`;

const normalizeLeadImpl = async (
  input: NormalizeLeadInput
): Promise<Result<NormalizedLeadFields>> => {
  const parsed = normalizeLeadSchema.safeParse(input);
  if (!parsed.success) {
    return err(
      new FeatureError(ErrorCodes.VALIDATION_ERROR, 'Invalid input', {
        issues: parsed.error.issues,
      })
    );
  }
  const { organizationId, ...fields } = parsed.data;

  const provided = Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v != null && v.trim() !== '')
  ) as NormalizedLeadFields;
  if (Object.keys(provided).length === 0) return ok({});

  try {
    if (!isAIClientInitialized()) {
      const apiKey = apiEnv.OPENAI_API_KEY;
      if (!apiKey) throw new Error('OPENAI_API_KEY is not configured');
      initAIClient({ apiKey });
    }
    const res = await chatCompletion(JSON.stringify(provided), {
      temperature: 0,
      maxTokens: 500,
      jsonResponse: true,
      systemMessage: NORMALIZE_SYSTEM_MESSAGE,
      observability: {
        spanName: 'leads.normalizeLead',
        properties: { organizationId },
      },
    });
    const cleaned = aiFieldsSchema.safeParse(JSON.parse(res.content));
    if (!cleaned.success) return ok(provided);

    // Only accept cleaned values for fields the user actually typed.
    const merged: NormalizedLeadFields = { ...provided };
    for (const key of Object.keys(provided) as (keyof NormalizedLeadFields)[]) {
      const value = cleaned.data[key];
      if (value) merged[key] = value;
    }
    return ok(merged);
  } catch (error) {
    logError('leads.normalizeLead', error, {
      feature: 'leads',
      extra: { organizationId },
    });
    return ok(provided); // never block creation on the cleaner
  }
};

export const normalizeLead = (input: NormalizeLeadInput) =>
  trackedResult('leads.normalizeLead', () => normalizeLeadImpl(input), {
    properties: { organizationId: input.organizationId },
  });

export type NormalizeLeadResult = Awaited<ReturnType<typeof normalizeLead>>;
