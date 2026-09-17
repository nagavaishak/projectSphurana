import { z } from 'zod';

// Type-style token registry (§9, §17). Templates cite by token; the renderer
// looks up font / size / weight / colour role from the active theme.
// Wave 3 wires the actual style bindings; for now the token enum is the
// contract.
export const TYPE_STYLE_TOKENS = [
  'display',
  'heading',
  'body',
  'caption',
] as const;

export type TypeStyleToken = (typeof TYPE_STYLE_TOKENS)[number];

export const typeStyleRef = z.enum(TYPE_STYLE_TOKENS);
