import {
  type CreateSocialPostFormValues,
  createSocialPostForm,
} from '@/features/social-posts/api';
import { z } from 'zod';

/**
 * The mobile create-content wizard renders the ONE shared create-social-post
 * declaration (`createSocialPostForm`) — the same schema, defaults and labels the
 * desktop {@link AddContentDialog} and the content-studio {@link PostContentDialog}
 * render. Only the STEPPING is local: the fields are split across screens so each
 * can validate on "Continue", and each step's schema is picked out of the shared
 * field specs rather than restated here (a restatement is how the mobile and web
 * schemas came to drift in the first place).
 */

const specs = createSocialPostForm.specs;

// Step 1 — pick the media (created video or uploaded asset).
export const mediaStepSchema = z.object({ mediaUrl: specs.mediaUrl.schema });

// Step 2 — title + caption.
export const detailsStepSchema = z.object({ title: specs.title.schema });

// Step 3 — choose the pages to post to.
export const pagesStepSchema = z.object({ pageIds: specs.pageIds.schema });

// Step 4 — schedule date + time.
export const scheduleStepSchema = z.object({
  date: specs.date.schema,
  time: specs.time.schema,
});

export const contentWizardSchema = createSocialPostForm.schema;

export type ContentWizardFormData = CreateSocialPostFormValues;

export const defaultContentWizardValues: ContentWizardFormData =
  createSocialPostForm.defaults;

export interface ContentWizardStep {
  id: 'select-media' | 'details' | 'pages' | 'schedule';
  schema: z.ZodSchema;
}

export const CONTENT_WIZARD_STEPS: ContentWizardStep[] = [
  { id: 'select-media', schema: mediaStepSchema },
  { id: 'details', schema: detailsStepSchema },
  { id: 'pages', schema: pagesStepSchema },
  { id: 'schedule', schema: scheduleStepSchema },
];
