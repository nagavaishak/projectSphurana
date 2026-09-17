import {
  type InferFormValues,
  defineForm,
} from '@/lib/form-contract/define-form';
import { z } from 'zod';

/**
 * The create-social-post form, declared ONCE for all three surfaces: the
 * content-calendar {@link AddContentDialog}, the mobile content wizard, and the
 * content-studio {@link PostContentDialog}. They used to keep three separate
 * schemas + three separate `defaultValues` literals for the same body, which is
 * how they drifted.
 *
 * THE VARIANT IS THE POINT. `PostContentDialog` offers "Post Now" / "Schedule
 * for Later", so the form is a discriminated union on `mode` — `date`/`time` are
 * optional in `now` and required in `schedule`. It shipped with NEITHER seeded in
 * `defaultValues`: untouched, the form sits in `now`, nothing looks wrong, and
 * the moment a user picked "Schedule for Later" submit sent `undefined` and zod
 * reported "expected string, received undefined" against two fields the user
 * could see were filled in — invisible in the UI and unfixable by them.
 *
 * Here `default` is a REQUIRED property whose type excludes `undefined`, so
 * every field carries one regardless of which branch requires it. That bug is now
 * a compile error, not a runtime surprise.
 *
 * See `@/lib/form-contract/define-form` for why the shape is this way.
 */
export const createSocialPostForm = defineForm({
  fields: {
    title: {
      schema: z.string().min(1, 'Title is required'),
      label: 'Title',
      control: 'text',
      default: '',
      sample: 'Launch Post',
    },
    caption: {
      schema: z.string().optional(),
      label: 'Caption',
      control: 'textarea',
      default: '',
      sample: 'Big news, book your slot now.',
    },
    /**
     * The chosen media. Every surface picks it differently (a tabbed grid, a
     * mobile media step, or an asset carried in from the gallery), so the
     * contract drives it with a `fills.mediaUrl` override.
     */
    mediaUrl: {
      schema: z.string().min(1, 'Please select content'),
      label: 'Content',
      control: 'custom',
      default: '',
      sample: 'https://cdn.example/clip.mp4',
    },
    mediaType: {
      schema: z.enum(['image', 'video']),
      default: 'image',
      exempt:
        'a property of the media the user picks (image vs video), set by the picker — never typed',
    },
    thumbnailUrl: {
      schema: z.string().optional(),
      default: '',
      exempt:
        "the chosen asset's poster frame, set by the picker alongside mediaUrl",
    },
    mediaId: {
      schema: z.string().optional(),
      default: '',
      exempt:
        'the picked asset/video id — used for AI caption generation and the selection highlight, never sent',
    },
    /** A multi-select popover / page list, not a labelled control — see `fills`. */
    pageIds: {
      schema: z.array(z.string()).min(1, 'Select at least one page'),
      label: 'Pages',
      control: 'custom',
      default: [],
      sample: ['page-1'],
    },
    mode: {
      schema: z.enum(['now', 'schedule']),
      // The two scheduler surfaces only ever schedule; content-studio seeds
      // `'now'` because its radio starts there.
      default: 'schedule',
      exempt: 'set by the Post now / Schedule for later radio',
    },
    /**
     * `date` + `time` fold into the wire's `scheduledAt`, so both are `derived`.
     *
     * The default is empty rather than "today": a form mounted a week after the
     * bundle loaded must default to the day it is OPENED, so each surface seeds
     * `now` over these at mount. An empty required field is fine — it renders an
     * actionable "Date is required". An ABSENT one is the bug, and it can no
     * longer be spelled.
     */
    date: {
      schema: z.string().min(1, 'Date is required'),
      label: 'Date',
      control: 'custom',
      default: '',
      sample: '',
      derived: true,
    },
    time: {
      schema: z.string().min(1, 'Time is required'),
      label: 'Time',
      control: 'time',
      default: '',
      sample: '14:30',
      derived: true,
    },
  },
  variants: {
    on: 'mode',
    cases: {
      now: { optional: ['date', 'time'] },
      schedule: {},
    },
  },
});

export const createSocialPostSchema = createSocialPostForm.schema;
export const createSocialPostDefaultValues = createSocialPostForm.defaults;
export const createSocialPostFields = createSocialPostForm.fields;

export type CreateSocialPostFormValues = InferFormValues<
  typeof createSocialPostForm
>;
