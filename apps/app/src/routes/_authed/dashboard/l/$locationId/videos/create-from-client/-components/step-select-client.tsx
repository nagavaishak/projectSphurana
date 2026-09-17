import { Search, UserCircle } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useListFaceGroups } from '@/features/face-groups';

import { useWizard } from './wizard-context';

export function StepSelectClient() {
  const { setFaceGroupId, goTo } = useWizard();
  const [search, setSearch] = useState('');

  const { faceGroups, isLoading, isError, refetch } = useListFaceGroups({
    limit: 100,
  });

  const filtered = useMemo(() => {
    if (!search.trim()) return faceGroups;
    const q = search.toLowerCase();
    return faceGroups.filter(
      (fg) =>
        fg.clientName?.toLowerCase().includes(q) ||
        fg.serviceName?.toLowerCase().includes(q)
    );
  }, [faceGroups, search]);

  const handleSelect = (id: string) => {
    setFaceGroupId(id);
    goTo('review-media');
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-semibold">Select a Client</h2>
        <p className="mt-1 text-muted-foreground">
          Choose a client to create a before &amp; after video for.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name or service..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10"
        />
      </div>

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={`sk-${i}`} className="h-[72px] w-full rounded-lg" />
          ))}
        </div>
      )}

      {/* BEFORE the empty check: `faceGroups` falls back to [] on a failed
          request, so "Upload assets first" was being shown to clinics whose
          assets are already uploaded — with no way on through the wizard. */}
      {!isLoading && isError && (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <UserCircle className="size-10 text-destructive" />
          <p className="text-destructive">Couldn't load your clients.</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <UserCircle className="size-10 text-muted-foreground" />
          <p className="text-muted-foreground">
            {search
              ? 'No clients match your search.'
              : 'No clients found. Upload assets first.'}
          </p>
        </div>
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
          {filtered.map((fg) => (
            <Card
              key={fg.id}
              className="cursor-pointer transition-colors hover:bg-accent/50"
            >
              <Button
                variant="ghost"
                className="flex h-auto w-full items-center justify-start gap-4 p-4"
                onClick={() => handleSelect(fg.id)}
              >
                <Avatar className="size-10">
                  <AvatarFallback>
                    {fg.clientName?.[0]?.toUpperCase() ?? '?'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-1 flex-col items-start gap-1">
                  <p className="truncate text-sm font-medium">
                    {fg.clientName ?? 'Unnamed Client'}
                  </p>
                  {fg.serviceName && (
                    <Badge variant="outline" className="text-[10px]">
                      {fg.serviceName}
                    </Badge>
                  )}
                </div>
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
