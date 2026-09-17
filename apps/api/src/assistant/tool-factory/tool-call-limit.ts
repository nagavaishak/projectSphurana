/** Maximum tool calls allowed per single chat request. */
export const MAX_TOOL_CALLS_PER_REQUEST = 50;

/**
 * A per-turn tool-call counter shared across every tool the model invokes.
 *
 * The counter is created once per chat request (in the controller) and
 * passed via `AssistantToolsContext`. The factory's wrapped execute checks
 * `count >= max` and short-circuits before the underlying tool runs, so a
 * runaway loop can never cost more than `max` tool dispatches per request.
 */
export interface ToolCallCounter {
  count: number;
  max: number;
}

export function createToolCallCounter(
  max: number = MAX_TOOL_CALLS_PER_REQUEST
): ToolCallCounter {
  return { count: 0, max };
}
