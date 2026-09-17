/**
 * Shared helpers for the tool implementations.
 *
 * `pathSchema` matters more than it looks: it is the same regex the page
 * schema enforces, so a model that invents `/Our Team` is refused at the tool
 * boundary rather than creating a page the renderer cannot route.
 */

import type { Block } from '@borradh-workspace/web-shared';
import { z } from 'zod';
import {
  ErrorCodes,
  FeatureError,
  type Result,
  err,
  ok,
} from '../../../shared/index.js';
import { blockSchemaByType } from '../../blocks/index.js';
import { BLOCK_CATALOGUE, variantsForBlock } from '../../blocks/index.js';

export const pathSchema = z
  .string()
  .min(1)
  .regex(/^\/[a-z0-9\-/]*$/, 'Path must start with "/" and be url-safe');

export const blockTypeSchema = z.enum(
  Object.keys(BLOCK_CATALOGUE) as [string, ...string[]]
);

/**
 * Props arrive as an open record and are validated against the BLOCK'S OWN
 * schema here.
 *
 * A discriminated union over the eight prop shapes would give the model a more
 * precise JSON schema, but Anthropic's `input_schema` must be a single object
 * at the top level — a union renders as `anyOf` and is rejected. So the model
 * is told the shapes in the catalogue block of the turn context, and this is
 * the gate that makes the telling non-negotiable.
 */
export const parseBlock = (candidate: {
  id: string;
  type: string;
  variant: string;
  props: Record<string, unknown>;
}): Result<Block> => {
  const schema =
    blockSchemaByType[candidate.type as keyof typeof blockSchemaByType];
  if (!schema) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `"${candidate.type}" is not a block type. Valid types: ${Object.keys(BLOCK_CATALOGUE).join(', ')}.`
      )
    );
  }

  const parsed = schema.safeParse(candidate);
  if (!parsed.success) {
    return err(
      new FeatureError(
        ErrorCodes.VALIDATION_ERROR,
        `Invalid ${candidate.type} block: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
        { issues: parsed.error.issues }
      )
    );
  }

  return ok(parsed.data as Block);
};

/**
 * An unknown variant is CORRECTED, not refused: the renderer falls back to the
 * first variant anyway, and refusing would fail a whole edit over a cosmetic
 * choice the model can be told about in the result.
 */
export const resolveRequestedVariant = (
  type: string,
  requested: string | undefined
): string => {
  const allowed = variantsForBlock(type as never);
  if (!requested) return allowed[0];
  return allowed.includes(requested) ? requested : allowed[0];
};

/** Ids are minted SERVER-SIDE — a model-chosen id can collide with a live one. */
export const newBlockId = (): string =>
  `blk_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
