import { leadSourceValues } from '@borradh-workspace/labels';
import { z } from 'zod';
import {
  deduplicateByValues,
  onDuplicateValues,
} from '../../../shared/labels.js';

// Re-export from shared (single source of truth)
export { deduplicateByValues, onDuplicateValues };
export type { DeduplicateBy, OnDuplicate } from '../../../shared/labels.js';

/**
 * Permissive schema for the outer import request - accepts any lead-shaped object.
 * Strict per-row validation (email format, source enum) happens inside the service.
 */
const importLeadRowInputSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  source: z.string().optional(),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  consentEmail: z.boolean().optional(),
  consentSms: z.boolean().optional(),
  consentVoice: z.boolean().optional(),
});

/**
 * Strict schema for per-row validation inside the service
 */
export const importLeadRowSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().email('Invalid email format').optional(),
  phone: z.string().optional(),
  whatsapp: z.string().optional(),
  source: z.enum(leadSourceValues).optional().default('manual'),
  tags: z.array(z.string()).optional(),
  notes: z.string().optional(),
  consentEmail: z.boolean().optional(),
  consentSms: z.boolean().optional(),
  consentVoice: z.boolean().optional(),
});

export type ImportLeadRow = z.infer<typeof importLeadRowSchema>;

/**
 * Schema for importing leads in bulk
 */
export const importLeadsSchema = z.object({
  organizationId: z.string().min(1, 'Organization ID is required'),
  leads: z
    .array(importLeadRowInputSchema)
    .min(1, 'At least one lead is required')
    .max(5000, 'Maximum 5000 leads per import'),
  deduplicateBy: z.enum(deduplicateByValues).default('email'),
  onDuplicate: z.enum(onDuplicateValues).default('skip'),
  defaultTags: z.array(z.string()).optional(),
  // Consent acknowledgment and defaults
  consentAcknowledgment: z.boolean().refine((val) => val === true, {
    message:
      'You must confirm that these leads have provided consent to be contacted',
  }),
  defaultConsentEmail: z.boolean().optional().default(false),
  defaultConsentSms: z.boolean().optional().default(false),
  defaultConsentVoice: z.boolean().optional().default(false),
});

export type ImportLeadsInput = z.infer<typeof importLeadsSchema>;

/**
 * Import error for a single row
 */
export interface ImportError {
  row: number;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Import result summary
 */
export interface ImportLeadsResult {
  imported: number;
  skipped: number;
  updated: number;
  errors: ImportError[];
}
