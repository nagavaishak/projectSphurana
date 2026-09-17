import { z } from 'zod';

export const renderDocOrientationSchema = z.enum([
  'portrait',
  'landscape',
  'square',
]);

export const renderDocLayerTypeSchema = z.enum([
  'broll',
  'b-roll',
  'educational-text',
  'text',
  'music',
  'audio',
]);

const timingSchema = z
  .object({
    startFrame: z.number().int().nonnegative().optional(),
    endFrame: z.number().int().nonnegative().optional(),
    durationInFrames: z.number().int().positive().optional(),
    from: z.number().int().nonnegative().optional(),
    duration: z.number().int().positive().optional(),
    startMs: z.number().nonnegative().optional(),
    endMs: z.number().nonnegative().optional(),
    durationMs: z.number().positive().optional(),
    startSeconds: z.number().nonnegative().optional(),
    endSeconds: z.number().nonnegative().optional(),
    durationSeconds: z.number().positive().optional(),
  })
  .passthrough();

export const renderDocLayerSchema = z
  .object({
    id: z.string().min(1),
    type: renderDocLayerTypeSchema,
    startFrame: z.number().int().nonnegative().optional(),
    endFrame: z.number().int().nonnegative().optional(),
    durationInFrames: z.number().int().positive().optional(),
    from: z.number().int().nonnegative().optional(),
    duration: z.number().int().positive().optional(),
    startMs: z.number().nonnegative().optional(),
    endMs: z.number().nonnegative().optional(),
    durationMs: z.number().positive().optional(),
    startSeconds: z.number().nonnegative().optional(),
    endSeconds: z.number().nonnegative().optional(),
    durationSeconds: z.number().positive().optional(),
    timing: timingSchema.optional(),
    props: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const renderDocSceneSchema = z
  .object({
    id: z.string().min(1),
    startFrame: z.number().int().nonnegative().optional(),
    endFrame: z.number().int().nonnegative().optional(),
    durationInFrames: z.number().int().positive().optional(),
    from: z.number().int().nonnegative().optional(),
    duration: z.number().int().positive().optional(),
    startMs: z.number().nonnegative().optional(),
    endMs: z.number().nonnegative().optional(),
    durationMs: z.number().positive().optional(),
    startSeconds: z.number().nonnegative().optional(),
    endSeconds: z.number().nonnegative().optional(),
    durationSeconds: z.number().positive().optional(),
    timing: timingSchema.optional(),
    layers: z.array(renderDocLayerSchema).default([]),
  })
  .passthrough();

export const renderDocMusicSchema = z
  .object({
    id: z.string().optional(),
    url: z.string().optional(),
    src: z.string().optional(),
    assetUrl: z.string().optional(),
    volume: z.number().min(0).max(1).optional(),
    startFrame: z.number().int().nonnegative().optional(),
    endFrame: z.number().int().nonnegative().optional(),
    durationInFrames: z.number().int().positive().optional(),
    from: z.number().int().nonnegative().optional(),
    duration: z.number().int().positive().optional(),
    startMs: z.number().nonnegative().optional(),
    endMs: z.number().nonnegative().optional(),
    durationMs: z.number().positive().optional(),
    startSeconds: z.number().nonnegative().optional(),
    endSeconds: z.number().nonnegative().optional(),
    durationSeconds: z.number().positive().optional(),
    timing: timingSchema.optional(),
  })
  .passthrough();

export const renderDocSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2), z.string()]).optional(),
    orientation: renderDocOrientationSchema,
    fps: z.number().int().positive().optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
    // v1 field — optional so v2 docs (which use totalFrames) pass validation
    durationInFrames: z.number().int().positive().optional(),
    // v2 field
    totalFrames: z.number().int().positive().optional(),
    layers: z.array(renderDocLayerSchema).default([]),
    scenes: z.array(renderDocSceneSchema).optional(),
    music: renderDocMusicSchema.optional(),
    audio: renderDocMusicSchema.optional(),
    // v2 spine/overlays fields
    spine: z
      .array(z.object({ kind: z.string(), id: z.string() }).passthrough())
      .optional(),
    overlays: z
      .array(z.object({ kind: z.string(), id: z.string() }).passthrough())
      .optional(),
    globals: z.object({}).passthrough().optional(),
  })
  .passthrough();

export const templateRendererPropsSchema = z.object({
  renderDoc: renderDocSchema,
});

export type RenderDocOrientation = z.infer<typeof renderDocOrientationSchema>;
export type RenderDocLayer = z.infer<typeof renderDocLayerSchema>;
export type RenderDocScene = z.infer<typeof renderDocSceneSchema>;
export type RenderDocMusic = z.infer<typeof renderDocMusicSchema>;
export type RenderDoc = z.infer<typeof renderDocSchema>;
export type TemplateRendererProps = z.infer<typeof templateRendererPropsSchema>;
