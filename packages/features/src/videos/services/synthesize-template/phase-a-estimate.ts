import type { TemplateDoc } from '@borradh-workspace/video-templates';

function countScriptItems(scriptText: string): number {
  const lines = scriptText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 0) {
    return lines.length;
  }

  return scriptText
    .split(/[.!?]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
}

export function estimateDuration(
  _templateDoc: TemplateDoc,
  scriptText: string,
  bpm: number,
  beatsPerItem = 4
): number {
  const secPerBeatGroup = (60 / bpm) * beatsPerItem;
  const items = Math.max(countScriptItems(scriptText) - 2, 1);
  const lead = true;
  const trail = true;
  const totalElements = (lead ? 1 : 0) + items + (trail ? 1 : 0);
  return totalElements * secPerBeatGroup + secPerBeatGroup;
}
