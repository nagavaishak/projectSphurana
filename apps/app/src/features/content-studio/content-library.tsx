import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MassVideoUploadDialog, useListAssets } from '@/features/assets';
import type { Asset, AssetType } from '@/features/assets';
import { formatDistanceToNow } from 'date-fns';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Image as ImageIcon,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { ContentCard, type ContentLibraryCardItem } from './content-card';
import { PreviewContentDialog } from './preview-content-dialog';

function mapAssetToContentItem(asset: Asset): ContentLibraryCardItem {
  const duration: number | null =
    asset.duration != null ? Number(asset.duration) : null;

  return {
    id: asset.id,
    title: asset.name,
    type: asset.type,
    thumbnailUrl: asset.blobUrl,
    duration,
    createdAt: formatDistanceToNow(new Date(asset.createdAt), {
      addSuffix: true,
    }),
  };
}

export function ContentLibrary() {
  const [activeTab, setActiveTab] = useState<'all' | 'video' | 'image'>('all');
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());
  const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const typeFilter: AssetType | undefined =
    activeTab === 'all' ? undefined : activeTab;

  const { assets, isLoading, isError, error, refetch } = useListAssets({
    type: typeFilter,
    limit: 100,
  });

  const handleUploadSuccess = (_assetIds?: string[]) => {
    refetch();
  };

  const contentItems = useMemo(() => {
    return assets.map(mapAssetToContentItem);
  }, [assets]);

  const paginatedContent = useMemo(() => {
    const start = (page - 1) * rowsPerPage;
    const end = start + rowsPerPage;
    return contentItems.slice(start, end);
  }, [contentItems, page, rowsPerPage]);

  const totalPages = Math.ceil(contentItems.length / rowsPerPage);

  const handlePreviewItem = (asset: Asset) => {
    setPreviewAsset(asset);
    setPreviewOpen(true);
  };

  const handleDownload = (asset: Asset) => {
    window.open(asset.blobUrl, '_blank');
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton
              key={`skeleton-${i}`}
              className="aspect-video w-full rounded-xl"
            />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ImageIcon />
          </EmptyMedia>
          <EmptyTitle>Failed to load content</EmptyTitle>
          <EmptyDescription>
            {error?.message ||
              'An error occurred while loading your content library.'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          setActiveTab(value as 'all' | 'video' | 'image');
          setPage(1);
          setSelectedRows(new Set());
        }}
      >
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="all">All Content</TabsTrigger>
            <TabsTrigger value="video">Videos</TabsTrigger>
            <TabsTrigger value="image">Images</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value={activeTab} className="mt-6">
          {contentItems.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ImageIcon />
                </EmptyMedia>
                <EmptyTitle>No content yet</EmptyTitle>
                <EmptyDescription>
                  Upload videos and images to start building your content
                  library.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <MassVideoUploadDialog onSuccess={handleUploadSuccess} />
              </EmptyContent>
            </Empty>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedContent.map((item) => {
                const asset = assets.find((a) => a.id === item.id);
                return (
                  <ContentCard
                    key={item.id}
                    item={item}
                    isSelected={selectedRows.has(item.id)}
                    onSelect={() => asset && handlePreviewItem(asset)}
                  />
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {contentItems.length > 0 ? (
        <div className="flex items-center justify-between border-t pt-4">
          <div className="text-sm text-muted-foreground">
            {selectedRows.size} of {contentItems.length} item(s) selected
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label htmlFor="rows-per-page" className="text-sm font-medium">
                Rows per page
              </Label>
              <Select
                value={`${rowsPerPage}`}
                onValueChange={(value) => {
                  setRowsPerPage(Number(value));
                  setPage(1);
                }}
              >
                <SelectTrigger className="w-20" id="rows-per-page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[10, 20, 30, 40, 50].map((size) => (
                    <SelectItem key={size} value={`${size}`}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="text-sm font-medium">
              Page {page} of {totalPages || 1}
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage(1)}
                disabled={page === 1}
              >
                <ChevronsLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                <ChevronRight className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setPage(totalPages)}
                disabled={page >= totalPages}
              >
                <ChevronsRight className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <PreviewContentDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        asset={previewAsset}
        onDownload={handleDownload}
      />
    </div>
  );
}
