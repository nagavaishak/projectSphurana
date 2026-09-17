import { notificationScopeValues } from '@borradh-workspace/labels';
import { z } from 'zod';

const channelsSchema = z.object({ email: z.boolean(), push: z.boolean() });

const scopedCategorySchema = z.object({
  scope: z.enum(notificationScopeValues),
  channels: channelsSchema,
});

const toggleCategorySchema = z.object({
  enabled: z.boolean(),
  channels: channelsSchema,
});

/**
 * The granular per-category notification settings persisted as a JSON column.
 * Sent as a complete object — the client loads it, mutates a copy, sends all.
 */
export const notificationPreferencesSchema = z.object({
  appointments: scopedCategorySchema,
  inbox: scopedCategorySchema,
  advertising: toggleCategorySchema,
  leads: scopedCategorySchema,
  orders: scopedCategorySchema,
});

export const updateNotificationPreferencesSchema = z.object({
  userId: z.string().min(1, 'User ID is required'),
  // Granular per-category notification settings.
  preferences: notificationPreferencesSchema.optional(),
  // Legacy marketing / digest toggles — a separate concern from `preferences`.
  marketingEmails: z.boolean().optional(),
  appUpdates: z.boolean().optional(),
  weeklyDigest: z.boolean().optional(),
});

export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;
