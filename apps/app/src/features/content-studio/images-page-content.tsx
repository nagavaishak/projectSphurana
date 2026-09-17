import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type Asset, useDeleteAsset, useListAssets } from '@/features/assets';
import { useGetSession } from '@/features/auth';
import {
  GraphicCard,
  useDeleteGraphic,
  useListGraphics,
} from '@/features/graphics';
import { Link } from '@tanstack/react-router';
import {
  Image as ImageIcon,
  Paintbrush,
  Plus,
  Search,
  Upload,
} from 'lucide-react';
import { useMemo, useState } from 'react';

import { AssetCard } from './asset-card';
import type { ContentItem } from './content-preview-dialog';
import { ContentPreviewDialog } from './content-preview-dialog';

export function ImagesPageContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [previewItem, setPreviewItem] = useState<ContentItem | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const { session } = useGetSession();
  const activeOrgId = session?.activeOrganizationId;

  const { assets: imageAssets, isLoading } = useListAssets({ type: 'image' });

  // AI-generated graphics (Gemini / branded-graphic engine)
  const { graphics, isLoading: graphicsLoading } = useListGraphics();
  const { deleteGraphic } = useDeleteGraphic();

  const { deleteAsset, isDeleting } = useDeleteAsset({
    onSuccess: () => {
      setPreviewOpen(false);
    },
  });

  const handleAssetClick = (asset: Asset) => {
    setPreviewItem({ kind: 'asset', data: asset });
    setPreviewOpen(true);
  };

  const handlePreviewDelete = (item: ContentItem) => {
    if (item.kind === 'asset') {
      deleteAsset(item.data.id);
    }
  };

  const filteredAssets = useMemo(
    () =>
      imageAssets.filter((a) =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [imageAssets, searchQuery]
  );

  const filteredGraphics = useMemo(
    () =>
      graphics.filter((g) =>
        (g.title ?? '').toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [graphics, searchQuery]
  );

  if (!activeOrgId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-muted-foreground">
          No organization selected. Please select an organization to view
          content.
        </p>
      </div>
    );
  }

  const toolbar = (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative flex-1 lg:max-w-md">
        <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          type="text"
          placeholder="Search images..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" asChild>
          <Link to="/upload-assets">
            <Upload className="size-4" />
            <span className="hidden lg:inline">Upload</span>
          </Link>
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {toolbar}

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="uploaded">
            Uploaded
            {imageAssets.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {imageAssets.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ai-generated">
            AI Generated
            {graphics.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {graphics.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="mt-4 space-y-6">
          {isLoading || graphicsLoading ? (
            <ImageLoadingSkeleton />
          ) : filteredAssets.length === 0 && filteredGraphics.length === 0 ? (
            <ImageEmptyState
              message={
                searchQuery ? 'No images match your search' : 'No images yet'
              }
              showUpload
            />
          ) : (
            <>
              {filteredGraphics.length > 0 && (
                <div>
                  <Label className="text-muted-foreground mb-3 block text-sm">
                    AI Generated ({filteredGraphics.length})
                  </Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {filteredGraphics.map((graphic) => (
                      <GraphicCard
                        key={graphic.id}
                        graphic={graphic}
                        onDelete={deleteGraphic}
                      />
                    ))}
                  </div>
                </div>
              )}

              {filteredAssets.length > 0 && (
                <div>
                  <Label className="text-muted-foreground mb-3 block text-sm">
                    Uploaded ({filteredAssets.length})
                  </Label>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
                    {filteredAssets.map((asset) => (
                      <AssetCard
                        key={asset.id}
                        asset={asset}
                        onClick={() => handleAssetClick(asset)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="uploaded" className="mt-4">
          {isLoading ? (
            <ImageLoadingSkeleton />
          ) : filteredAssets.length === 0 ? (
            <ImageEmptyState
              message={
                searchQuery
                  ? 'No uploaded images match your search'
                  : 'No uploaded images yet'
              }
              showUpload
            />
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredAssets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onClick={() => handleAssetClick(asset)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="ai-generated" className="mt-4">
          {graphicsLoading ? (
            <ImageLoadingSkeleton />
          ) : filteredGraphics.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Paintbrush />
                </EmptyMedia>
                <EmptyTitle>
                  {searchQuery
                    ? 'No graphics match your search'
                    : 'No graphics yet'}
                </EmptyTitle>
                <EmptyDescription>
                  Graphics created on the platform will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
              {filteredGraphics.map((graphic) => (
                <GraphicCard
                  key={graphic.id}
                  graphic={graphic}
                  onDelete={deleteGraphic}
                />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ContentPreviewDialog
        item={previewItem}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onDelete={handlePreviewDelete}
        isDeleting={isDeleting}
      />
    </div>
  );
}

function ImageLoadingSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={`skeleton-${i}`} className="aspect-[3/4] rounded-xl" />
      ))}
    </div>
  );
}

function ImageEmptyState({
  message = 'No images yet',
  showUpload = false,
}: {
  message?: string;
  showUpload?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <ImageIcon className="size-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{message}</h3>
      <p className="text-muted-foreground max-w-md mb-4">
        Upload images to build your content library.
      </p>
      {showUpload && (
        <Button asChild>
          <Link to="/upload-assets">
            <Plus className="size-4" />
            Upload Images
          </Link>
        </Button>
      )}
    </div>
  );
}
