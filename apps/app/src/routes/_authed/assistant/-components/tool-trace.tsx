import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from '@/components/ai-elements/chain-of-thought';
import {
  HIDDEN_FROM_TRACE_TOOLS,
  RICH_TOOL_NAMES,
  type ToolPartData,
  asToolPart,
  getToolName,
  toolNameToLabel,
} from '@/features/assistant';
import type { UIMessage } from 'ai';
import { Wrench } from 'lucide-react';

interface ToolTraceProps {
  /** All parts of an assistant message; we extract the tool calls in order. */
  parts: UIMessage['parts'];
}

/**
 * Inline + expandable trace of every tool call on a message.
 *
 * The header summarises the *latest* tool's status (or "Used N tools"
 * when complete). Expanding reveals one step per tool with state +
 * sanitised input. Rich confirmation tools are still rendered as their
 * own components below the trace; this trace shows the trail behind them.
 */
export function ToolTrace({ parts }: ToolTraceProps) {
  const tools: ToolPartData[] = [];
  for (const part of parts) {
    const tp = asToolPart(part);
    // Skip pure-infrastructure tools (skill loading, UI tour) so they don't
    // leak as cryptic entries like "Meta_load Skill" in the trace.
    if (tp && !HIDDEN_FROM_TRACE_TOOLS.has(getToolName(tp))) {
      tools.push(tp);
    }
  }

  if (tools.length === 0) return null;

  // Hide trace entirely when every visible tool has already been
  // rendered as a rich confirmation card (avoids duplicate noise).
  const allRich = tools.every((tp) => RICH_TOOL_NAMES.has(getToolName(tp)));
  if (allRich && tools.every((tp) => tp.state === 'output-available')) {
    return null;
  }

  const latest = tools[tools.length - 1];
  const headerLabel = buildHeaderLabel(tools, latest);

  return (
    <ChainOfThought>
      <ChainOfThoughtHeader>{headerLabel}</ChainOfThoughtHeader>
      <ChainOfThoughtContent>
        {tools.map((tp, i) => (
          <ChainOfThoughtStep
            key={`${tp.toolCallId}-${i}`}
            icon={Wrench}
            label={toolNameToLabel(getToolName(tp))}
            description={describeStep(tp)}
            status={mapStatus(tp.state)}
          />
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

function buildHeaderLabel(tools: ToolPartData[], latest: ToolPartData): string {
  // TODO(c-02): use defineTool factory's `statusLabel` once the new
  // wire format ships. Until then, derive a label from the tool name.
  const latestLabel = toolNameToLabel(getToolName(latest));
  const allComplete = tools.every((tp) => tp.state === 'output-available');
  if (allComplete) {
    return tools.length === 1
      ? `Used 1 tool: ${latestLabel}`
      : `Used ${tools.length} tools`;
  }
  if (latest.state === 'input-streaming') {
    return `Preparing ${latestLabel}…`;
  }
  if (latest.state === 'output-error') {
    return `${latestLabel} errored`;
  }
  return `Running ${latestLabel}…`;
}

function describeStep(tp: ToolPartData): string {
  switch (tp.state) {
    case 'output-available':
      return 'Complete';
    case 'output-error':
      return tp.errorText ?? 'Errored';
    case 'input-streaming':
      return 'Preparing input…';
    case 'input-available':
      return 'Awaiting your response';
    default:
      return 'Running…';
  }
}

function mapStatus(state: string): 'complete' | 'active' | 'pending' {
  if (state === 'output-available') return 'complete';
  if (state === 'output-error') return 'complete';
  if (state === 'input-streaming') return 'pending';
  return 'active';
}
