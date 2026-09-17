import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { type Asset, useDeleteAsset, useListAssets } from '@/features/assets';
import { useGetSession } from '@/features/auth';
import { NewPostDialog } from '@/features/socials/components/new-post-dialog';
import type { Video, VideoStatus } from '@/features/videos';
import { useDeleteVideo, useListVideos } from '@/features/videos';
import { Link } from '@tanstack/react-router';
import { Plus, Search, Upload, Video as VideoIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AssetCard } from './asset-card';
import type { ContentItem } from './content-preview-dialog';
import { ContentPreviewDialog } from './content-preview-dialog';
import { VideoCard } from './video-card';

export function VideosPageContent() {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | VideoStatus>('all');
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<ContentItem | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const { session } = useGetSession();
  const activeOrgId = session?.activeOrganizationId;

  // Uploaded video assets
  const {
    assets: videoAssets,
    isLoading: assetsLoading,
    isError: assetsError,
    refetch: refetchAssets,
  } = useListAssets({
    type: 'video',
  });

  // AI-generated videos
  const {
    videos,
    isLoading: videosLoading,
    isError: videosError,
    refetch: refetchVideos,
  } = useListVideos();
  const { deleteVideo, isDeleting } = useDeleteVideo({
    onSuccess: () => {
      toast.success('Video deleted');
      refetchVideos();
      setPreviewOpen(false);
    },
  });
  const { deleteAsset, isDeleting: isDeletingAsset } = useDeleteAsset({
    onSuccess: () => {
      setPreviewOpen(false);
    },
  });

  const handleAssetClick = (asset: Asset) => {
    setPreviewItem({ kind: 'asset', data: asset });
    setPreviewOpen(true);
  };

  const handleVideoClick = (video: Video) => {
    setPreviewItem({ kind: 'video', data: video });
    setPreviewOpen(true);
  };

  const handlePreviewDelete = (item: ContentItem) => {
    if (item.kind === 'asset') {
      deleteAsset(item.data.id);
    } else {
      deleteVideo(item.data.id);
    }
  };

  // ─── Filtered lists ───

  const filteredAssets = useMemo(
    () =>
      videoAssets.filter((a) =>
        a.name.toLowerCase().includes(searchQuery.toLowerCase())
      ),
    [videoAssets, searchQuery]
  );

  const filteredVideos = useMemo(
    () =>
      videos.filter((v) => {
        if (v.status === 'draft' || v.status === 'failed') return false;
        const matchesSearch =
          !searchQuery ||
          v.title?.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesStatus =
          statusFilter === 'all' || v.status === statusFilter;
        return matchesSearch && matchesStatus;
      }),
    [videos, searchQuery, statusFilter]
  );

  const processingVideos = filteredVideos.filter(
    (v) => v.status === 'processing' || v.status === 'queued'
  );
  const readyVideos = filteredVideos.filter((v) => v.status === 'ready');

  const isLoading = assetsLoading || videosLoading;

  // ─── Shared toolbar ───

  const toolbar = (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="relative flex-1 lg:max-w-md">
        <Search className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
        <Input
          type="text"
          placeholder="Search videos..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCreateModalOpen(true)}
        >
          <VideoIcon className="size-4" />
          <span className="hidden lg:inline">Create Video</span>
        </Button>
        <Button size="sm" asChild>
          <Link to="/upload-assets">
            <Upload className="size-4" />
            <span className="hidden lg:inline">Upload</span>
          </Link>
        </Button>
      </div>
    </div>
  );

  // ─── Empty / no-org guards ───

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

  return (
    <div className="flex flex-col gap-4">
      {toolbar}

      <Tabs defaultValue="all">
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="uploaded">
            Uploaded
            {videoAssets.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {videoAssets.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="ai-generated">
            AI Generated
            {videos.length > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-xs">
                {videos.length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─── All tab ─── */}
        <TabsContent value="all" className="space-y-6 mt-4">
          {isLoading ? (
            <LoadingSkeleton />
          ) : assetsError && videosError ? (
            // Only when BOTH failed — if one list loaded, show what we have
            // rather than hiding real content behind an error.
            <LoadError
              message="Couldn't load your videos"
              onRetry={() => {
                refetchAssets();
                refetchVideos();
              }}
            />
          ) : filteredAssets.length === 0 && filteredVideos.length === 0 ? (
            <EmptyState
              onCreateClick={() => setCreateModalOpen(true)}
              showUpload
            />
          ) : (
            <>
              {/* Uploaded section */}
              {filteredAssets.length > 0 && (
                <div>
                  <Label className="text-sm text-muted-foreground mb-3 block">
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

              {/* AI Generated section */}
              {filteredVideos.length > 0 && (
                <div>
                  <Label className="text-sm text-muted-foreground mb-3 block">
                    AI Generated ({filteredVideos.length})
                  </Label>
                  <VideoGrid
                    processingVideos={processingVideos}
                    readyVideos={readyVideos}
                    onVideoClick={handleVideoClick}
                    onDelete={deleteVideo}
                    isDeleting={isDeleting}
                  />
                </div>
              )}
            </>
          )}
        </TabsContent>

        {/* ─── Uploaded tab ─── */}
        <TabsContent value="uploaded" className="mt-4">
          {assetsLoading ? (
            <LoadingSkeleton />
          ) : assetsError ? (
            <LoadError
              message="Couldn't load your uploads"
              onRetry={() => refetchAssets()}
            />
          ) : filteredAssets.length === 0 ? (
            <EmptyState
              message={
                searchQuery
                  ? 'No uploaded videos match your search'
                  : 'No uploaded videos yet'
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

        {/* ─── AI Generated tab ─── */}
        <TabsContent value="ai-generated" className="mt-4">
          <div className="flex items-center gap-2 mb-4">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as 'all' | VideoStatus)}
            >
              <SelectTrigger className="w-[140px]" size="sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="ready">Ready</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {videosLoading ? (
            <LoadingSkeleton aspect="9/16" />
          ) : videosError ? (
            <LoadError
              message="Couldn't load your AI-generated videos"
              onRetry={() => refetchVideos()}
            />
          ) : filteredVideos.length === 0 ? (
            <EmptyState
              message={
                searchQuery || statusFilter !== 'all'
                  ? 'No videos match your filters'
                  : 'No AI-generated videos yet'
              }
              onCreateClick={() => setCreateModalOpen(true)}
            />
          ) : (
            <VideoGrid
              processingVideos={processingVideos}
              readyVideos={readyVideos}
              onVideoClick={handleVideoClick}
              onDelete={deleteVideo}
              isDeleting={isDeleting}
            />
          )}
        </TabsContent>
      </Tabs>

      <ContentPreviewDialog
        item={previewItem}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onDelete={handlePreviewDelete}
        isDeleting={isDeleting || isDeletingAsset}
      />

      <NewPostDialog open={createModalOpen} onOpenChange={setCreateModalOpen} />
    </div>
  );
}

// ─── Sub-components ───

function LoadingSkeleton({ aspect = '3/4' }: { aspect?: string }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton
          key={`skeleton-${i}`}
          className="rounded-xl"
          style={{ aspectRatio: aspect }}
        />
      ))}
    </div>
  );
}

/**
 * Shown INSTEAD of `EmptyState` when the list request failed. Both `assets`
 * and `videos` default to `[]` on failure, so without this the page tells a
 * library full of content that it has none, and offers to create more.
 */
function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-destructive/10 p-4 mb-4">
        <VideoIcon className="size-8 text-destructive" />
      </div>
      <h3 className="text-lg font-semibold mb-2 text-destructive">{message}</h3>
      <p className="text-muted-foreground max-w-md mb-4">
        This is a loading problem, not an empty library.
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

function EmptyState({
  message = 'No videos yet',
  onCreateClick,
  showUpload = false,
}: {
  message?: string;
  onCreateClick?: () => void;
  showUpload?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="rounded-full bg-muted p-4 mb-4">
        <VideoIcon className="size-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold mb-2">{message}</h3>
      <p className="text-muted-foreground max-w-md mb-4">
        Upload video content or create AI-generated videos.
      </p>
      <div className="flex gap-2">
        {onCreateClick && (
          <Button variant="outline" onClick={onCreateClick}>
            <VideoIcon className="size-4" />
            Create Video
          </Button>
        )}
        {showUpload && (
          <Button asChild>
            <Link to="/upload-assets">
              <Plus className="size-4" />
              Upload
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

function VideoGrid({
  processingVideos,
  readyVideos,
  onVideoClick,
  onDelete,
  isDeleting,
}: {
  processingVideos: Video[];
  readyVideos: Video[];
  onVideoClick: (video: Video) => void;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  return (
    <div className="space-y-6">
      {processingVideos.length > 0 && (
        <div>
          <Label className="text-sm text-muted-foreground mb-3 block">
            Processing ({processingVideos.length})
          </Label>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {processingVideos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                onClick={() => onVideoClick(video)}
                onDelete={onDelete}
                isDeleting={isDeleting}
              />
            ))}
          </div>
        </div>
      )}

      {readyVideos.length > 0 && (
        <div>
          {processingVideos.length > 0 && (
            <Label className="text-sm text-muted-foreground mb-3 block">
              Ready ({readyVideos.length})
            </Label>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {readyVideos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                onClick={() => onVideoClick(video)}
                onDelete={onDelete}
                isDeleting={isDeleting}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
