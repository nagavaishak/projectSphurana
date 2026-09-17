import type {
  Slot,
  SlotQuery,
  TemplateDoc,
} from '@borradh-workspace/video-templates';
import { z } from 'zod';

export const scriptResponseSchema = z.object({
  hook: z.string().min(1),
  body: z.array(z.string().min(1)).default([]),
  cta: z.string().min(1).optional(),
  disclaimer: z.string().min(1).optional(),
  // Generic additional lists for multi-list templates (e.g. ins-outs INS/OUTS),
  // referenced by a `script-text` slot with role 'list' + index. `body` remains
  // the conventional single list; `lists` is purely additive.
  lists: z.array(z.array(z.string().min(1))).optional(),
});

export type ScriptResponse = z.infer<typeof scriptResponseSchema>;

export type ScriptRole = 'hook' | 'body' | 'cta' | 'disclaimer' | 'list';

export interface DiscoveredScriptSlot {
  role: ScriptRole;
  index?: number;
  required: boolean;
  valueShape: 'string' | 'string-array';
  bodyCount?: [min: number, max: number];
}

export function discoverScriptSlots(doc: TemplateDoc): DiscoveredScriptSlot[] {
  const discovered: DiscoveredScriptSlot[] = [];

  const visitStringSlot = (slot: Slot<string> | undefined) => {
    if (!slot || slot.source !== 'query') return;
    if (slot.query.kind !== 'script-text') return;
    discovered.push({
      role: slot.query.role,
      index: slot.query.index,
      required: slot.required,
      valueShape: 'string',
    });
  };

  const visitStringArraySlot = (slot: Slot<string[]> | undefined) => {
    if (!slot || slot.source !== 'query') return;
    if (slot.query.kind !== 'script-text') return;
    discovered.push({
      role: slot.query.role,
      index: slot.query.index,
      required: slot.required,
      valueShape: 'string-array',
    });
  };

  const visitRegion = (region: TemplateDoc['root']) => {
    if (region.kind === 'leaf') {
      for (const block of region.overlays) {
        if (block.kind === 'staggered-list') {
          visitStringSlot(block.lead?.text);
          visitStringArraySlot(block.items.texts);
          visitStringSlot(block.trail?.text);
        } else if (block.kind === 'text') {
          visitStringSlot(block.text);
        } else if (block.kind === 'info-card') {
          if (block.headline) visitStringSlot(block.headline.text);
          if (block.items) visitStringArraySlot(block.items.texts);
          if (block.cta) visitStringSlot(block.cta.text);
        }
      }
      return;
    }
    for (const child of region.children) visitRegion(child.region);
  };

  visitRegion(doc.root);
  return discovered;
}

export function collectRequiredRoles(slots: DiscoveredScriptSlot[]): Array<{
  role: ScriptRole;
  required: boolean;
  bodyCount?: [number, number];
  /** For role 'list': how many distinct lists the template declares. */
  listCount?: number;
}> {
  const seen = new Map<
    ScriptRole,
    {
      role: ScriptRole;
      required: boolean;
      bodyCount?: [number, number];
      listCount?: number;
    }
  >();
  for (const slot of slots) {
    const existing = seen.get(slot.role);
    if (existing) {
      if (slot.required) existing.required = true;
      if (slot.role === 'list') {
        existing.listCount = Math.max(
          existing.listCount ?? 0,
          (slot.index ?? 0) + 1
        );
      }
      continue;
    }
    seen.set(slot.role, {
      role: slot.role,
      required: slot.required,
      listCount: slot.role === 'list' ? (slot.index ?? 0) + 1 : undefined,
    });
  }
  return Array.from(seen.values());
}

export interface FillSlotsResult {
  filled: TemplateDoc;
  missingRequiredRoles: ScriptRole[];
}

export function fillScriptSlots(
  doc: TemplateDoc,
  response: ScriptResponse
): FillSlotsResult {
  const missing: ScriptRole[] = [];

  const resolveString = (
    slot: Slot<string>,
    query: Extract<SlotQuery, { kind: 'script-text' }>
  ): Slot<string> => {
    const value = pickStringForRole(response, query.role, query.index);
    if (value === undefined) {
      if (slot.source === 'query' && slot.required) missing.push(query.role);
      return slot;
    }
    return { source: 'fixed', value };
  };

  const resolveStringArray = (
    slot: Slot<string[]>,
    query: Extract<SlotQuery, { kind: 'script-text' }>
  ): Slot<string[]> => {
    const value = pickArrayForRole(response, query.role, query.index);
    if (value === undefined) {
      if (slot.source === 'query' && slot.required) missing.push(query.role);
      return slot;
    }
    return { source: 'fixed', value };
  };

  const mapStringSlot = (slot: Slot<string>): Slot<string> => {
    if (slot.source !== 'query' || slot.query.kind !== 'script-text') {
      return slot;
    }
    return resolveString(slot, slot.query);
  };

  const mapStringArraySlot = (slot: Slot<string[]>): Slot<string[]> => {
    if (slot.source !== 'query' || slot.query.kind !== 'script-text') {
      return slot;
    }
    return resolveStringArray(slot, slot.query);
  };

  const visitRegion = (region: TemplateDoc['root']): TemplateDoc['root'] => {
    if (region.kind === 'leaf') {
      return {
        ...region,
        overlays: region.overlays.map((block) => {
          if (block.kind === 'staggered-list') {
            return {
              ...block,
              lead: block.lead
                ? { ...block.lead, text: mapStringSlot(block.lead.text) }
                : undefined,
              items: {
                ...block.items,
                texts: mapStringArraySlot(block.items.texts),
              },
              trail: block.trail
                ? { ...block.trail, text: mapStringSlot(block.trail.text) }
                : undefined,
            };
          }
          if (block.kind === 'text') {
            return { ...block, text: mapStringSlot(block.text) };
          }
          if (block.kind === 'info-card') {
            return {
              ...block,
              headline: block.headline
                ? {
                    ...block.headline,
                    text: mapStringSlot(block.headline.text),
                  }
                : undefined,
              items: block.items
                ? {
                    ...block.items,
                    texts: mapStringArraySlot(block.items.texts),
                  }
                : undefined,
              cta: block.cta
                ? { ...block.cta, text: mapStringSlot(block.cta.text) }
                : undefined,
            };
          }
          return block;
        }),
      };
    }
    return {
      ...region,
      children: region.children.map((c) => ({
        ...c,
        region: visitRegion(c.region),
      })),
    };
  };

  return {
    filled: { ...doc, root: visitRegion(doc.root) },
    missingRequiredRoles: Array.from(new Set(missing)),
  };
}

function pickStringForRole(
  response: ScriptResponse,
  role: ScriptRole,
  index?: number
): string | undefined {
  if (role === 'hook') return response.hook;
  if (role === 'cta') return response.cta;
  if (role === 'disclaimer') return response.disclaimer;
  if (role === 'body') {
    const i = index ?? 0;
    return response.body[i];
  }
  if (role === 'list') {
    return response.lists?.[index ?? 0]?.[0];
  }
  return undefined;
}

function pickArrayForRole(
  response: ScriptResponse,
  role: ScriptRole,
  index?: number
): string[] | undefined {
  if (role === 'body') return response.body;
  if (role === 'hook') return [response.hook];
  if (role === 'cta') return response.cta ? [response.cta] : undefined;
  if (role === 'disclaimer')
    return response.disclaimer ? [response.disclaimer] : undefined;
  if (role === 'list') return response.lists?.[index ?? 0];
  return undefined;
}

export function flattenScriptForLegacyCompiler(
  response: ScriptResponse
): string {
  const lines: string[] = [response.hook, ...response.body];
  for (const list of response.lists ?? []) lines.push(...list);
  if (response.disclaimer) lines.push(response.disclaimer);
  if (response.cta) lines.push(response.cta);
  return lines.join('\n');
}
