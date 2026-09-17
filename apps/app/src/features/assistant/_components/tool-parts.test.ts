import { describe, expect, it } from 'vitest';

import { type ToolPartData, getToolName } from './tool-parts';

function toolPart(type: string): ToolPartData {
  return { type, state: 'output-available', toolCallId: 'call-1', input: {} };
}

describe('getToolName', () => {
  it('normalizes the namespaced video tool used by mobile Claire', () => {
    expect(getToolName(toolPart('tool-videos_createDraftVideo'))).toBe(
      'createDraftVideo'
    );
  });

  it('keeps unnamespaced tool names working', () => {
    expect(getToolName(toolPart('tool-createDraftVideo'))).toBe(
      'createDraftVideo'
    );
  });
});
