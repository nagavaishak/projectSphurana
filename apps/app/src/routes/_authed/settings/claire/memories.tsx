import { createFileRoute } from '@tanstack/react-router';

import { MemoriesList } from '@/features/assistant';

/**
 * `/settings/claire/memories` — manage what Claire remembers about the
 * user and their business.
 *
 * Backed by the NestJS assistant module:
 *   GET    /assistant/memories
 *   PATCH  /assistant/memories/:id
 *   DELETE /assistant/memories/:id
 *
 * Reachable only via deep-link from Claire surfaces (memory pills, etc.).
 */
export const Route = createFileRoute('/_authed/settings/claire/memories')({
  component: ClaireMemoriesPage,
});

function ClaireMemoriesPage() {
  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h2 className="text-xl font-semibold tracking-tight">
          Claire&apos;s memories
        </h2>
        <p className="text-muted-foreground text-sm">
          Things Claire remembers about you and your business. She uses these in
          conversations.
        </p>
      </header>

      <MemoriesList />
    </div>
  );
}
