import type { LucideIcon } from 'lucide-react';

import { PageShell } from '@/components/app/page-shell';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';

interface PlaceholderPageProps {
  title: string;
  description: string;
  icon: LucideIcon;
}

/**
 * Empty-state page for nav destinations whose backend has not shipped yet.
 * Keeps the URL tree and sidebar complete while features land incrementally.
 */
export function PlaceholderPage({
  title,
  description,
  icon: Icon,
}: PlaceholderPageProps) {
  return (
    <>
      <title>{`${title} | Borradh`}</title>
      <PageShell>
        <div className="flex flex-1 items-center justify-center">
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Icon />
              </EmptyMedia>
              <EmptyTitle>{title}</EmptyTitle>
              <EmptyDescription>{description}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </div>
      </PageShell>
    </>
  );
}
