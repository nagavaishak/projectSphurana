import { PlusIcon } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { NewPostDialog } from './new-post-dialog';

/**
 * Planner header action: opens the new-post dialog. Owns its own open state so
 * it can sit in the tab row beside the bulk-create button, independent of the
 * planner list below.
 */
export function NewPostButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon />
        Generate content
      </Button>
      <NewPostDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
