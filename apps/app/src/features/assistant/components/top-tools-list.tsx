import { Wrench } from 'lucide-react';

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

export interface TopToolsListProps {
  tools: Array<{ toolName: string; count: number }>;
}

/**
 * Renders the top tools used by the operator. Backend currently returns an
 * empty array — tool-call counts are tracked via PostHog `claire.tool_called`
 * events, and a query path from the API back into PostHog is out of scope for
 * v3.
 *
 * When the data does land, each row is a label + count. Until then we surface
 * a friendly placeholder rather than an empty card so operators understand
 * the section will populate later.
 */
export function TopToolsList({ tools }: TopToolsListProps) {
  if (tools.length === 0) {
    return (
      <Empty className="py-8">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Wrench />
          </EmptyMedia>
          <EmptyTitle>Top tools coming soon</EmptyTitle>
          <EmptyDescription>
            Once we&apos;ve gathered a bit of usage data, you&apos;ll see which
            of Claire&apos;s tools you reach for most.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <ul className="divide-y">
      {tools.map((tool) => (
        <li
          key={tool.toolName}
          className="flex items-center justify-between py-3"
        >
          <span className="text-sm font-medium">{tool.toolName}</span>
          <span className="text-muted-foreground text-sm">
            {tool.count.toLocaleString()}
          </span>
        </li>
      ))}
    </ul>
  );
}
