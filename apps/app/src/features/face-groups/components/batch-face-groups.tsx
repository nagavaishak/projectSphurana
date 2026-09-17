import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { UsersIcon } from 'lucide-react';
import { useGetBatchFaceGroups } from '../api/get-batch-face-groups';
import { FaceGroupCard } from './face-group-card';

interface BatchFaceGroupsProps {
  batchId: string;
}

export function BatchFaceGroups({ batchId }: BatchFaceGroupsProps) {
  const { faceGroups, isLoading } = useGetBatchFaceGroups(batchId);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (faceGroups.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <Separator />
      <div className="flex items-center gap-2">
        <UsersIcon className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-medium text-sm">Before/After Groups</h3>
        <Badge variant="secondary">{faceGroups.length} groups</Badge>
      </div>

      <div className="grid gap-3">
        {faceGroups.map((group) => (
          <FaceGroupCard key={group.id} group={group} />
        ))}
      </div>
    </div>
  );
}
