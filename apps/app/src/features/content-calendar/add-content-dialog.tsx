import { zodResolver } from '@hookform/resolvers/zod';
import { format, parse } from 'date-fns';
import {
  Check,
  CheckIcon,
  FacebookIcon,
  Film,
  ImageIcon,
  InstagramIcon,
  Loader2,
  SaveIcon,
  Search,
  Upload,
  UploadIcon,
  VideoIcon,
  XIcon,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';

import { AiFieldWrapper } from '@/components/ui/ai-field-wrapper';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  type GeneratedContent,
  useGenerateContent,
} from '@/features/ai-content';
import { useCreateAsset, useListAssets } from '@/features/assets';
import { useClaireWidgetState } from '@/features/claire/lib/widget-state';
import { useListMetaAdsPages } from '@/features/integrations';
import { useActiveOrganization } from '@/features/organization/api/get-active-organization';
import {
  SocialPostPreview,
  useCreateSocialPost,
} from '@/features/social-posts';
import {
  type CreateSocialPostFormValues,
  createSocialPostForm,
} from '@/features/social-posts/api';
import type { SocialPostPlatform } from '@/features/social-posts/types';
import { useUploadImage, useUploadVideo } from '@/features/upload';
import { getVideoQueryOptions, useListVideos } from '@/features/videos';
import { zonedEvent } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Schema, defaults and labels all come from the ONE shared declaration every
 * create-social-post surface renders from.
 */
const L = createSocialPostForm.labels;

type FormData = CreateSocialPostFormValues;

interface AddContentDialogProps {
  children?: React.ReactNode;
  startDate?: Date;
  startTime?: { hour: number; minute: number };
}

/**
 * Custom add content dialog for scheduling social media posts
 * Conforms to ICalendarConfig.customAddDialog interface
 */
export function AddContentDialog({
  children,
  startDate,
  startTime,
}: AddContentDialogProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [pagesPopoverOpen, setPagesPopoverOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'videos' | 'assets'>('videos');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isTourRunning = useClaireWidgetState((s) => s.isTourRunning);
  const handleInteractOutside = useCallback(
    (e: Event) => {
      if (isTourRunning) e.preventDefault();
    },
    [isTourRunning]
  );

  const { pages, isLoading: isPagesLoading } = useListMetaAdsPages();
  const { videos, isLoading: isLoadingVideos } = useListVideos();
  const { assets, isLoading: isLoadingAssets } = useListAssets();

  // Filter created videos - only show ready videos
  const availableVideos = videos.filter(
    (video) =>
      video.status === 'ready' &&
      video.title?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter uploaded assets
  const availableAssets = assets.filter((asset) =>
    asset.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const { createSocialPost, isCreating } = useCreateSocialPost({
    onSuccess: () => {
      setOpen(false);
      form.reset();
      setSelectedFileName(null);
      setUploadProgress(0);
      setSearchQuery('');
    },
  });

  const { data: organization } = useActiveOrganization();
  const timeZone = organization?.timezone ?? 'UTC';
  const now = startDate || new Date();
  // Default the pickers to the clicked slot (or "now") as wall-clock in the
  // BUSINESS zone, so a scheduler in another timezone sees the org's time.
  const zonedNow = zonedEvent(now.toISOString(), timeZone);
  const defaultTime = startTime
    ? `${String(startTime.hour).padStart(2, '0')}:${String(startTime.minute).padStart(2, '0')}`
    : format(zonedNow, 'HH:mm');

  const form = useForm<FormData>({
    resolver: zodResolver(createSocialPostForm.schema),
    defaultValues: {
      ...createSocialPostForm.defaults,
      // A dialog opened today must default to today, so the schedule is seeded
      // at mount rather than at module load.
      date: format(zonedNow, 'yyyy-MM-dd'),
      time: defaultTime,
    },
  });

  const { uploadAsync: uploadImage, isUploading: isUploadingImage } =
    useUploadImage({
      onProgress: setUploadProgress,
    });

  const { uploadAsync: uploadVideo, isUploading: isUploadingVideo } =
    useUploadVideo({
      onProgress: setUploadProgress,
    });

  const { createAssetAsync, isCreating: isCreatingAsset } = useCreateAsset();

  const isUploading = isUploadingImage || isUploadingVideo || isCreatingAsset;

  const [hasAiGenerated, setHasAiGenerated] = useState(false);

  const { generateContent, isGenerating } = useGenerateContent({
    onSuccess: (data: GeneratedContent) => {
      if (data.contentType === 'social-post') {
        const hashtags = data.content.hashtags
          .map((t: string) => `#${t}`)
          .join(' ');
        const fullCaption =
          data.content.caption + (hashtags ? `\n\n${hashtags}` : '');
        form.setValue('caption', fullCaption, { shouldDirty: true });
        setHasAiGenerated(true);
      }
    },
  });

  const handleSelectVideo = async (video: (typeof videos)[0]) => {
    let url = video.blobUrl || '';

    // The list API omits blobUrl for performance — fetch the individual video
    if (!url) {
      try {
        const full = await queryClient.fetchQuery(
          getVideoQueryOptions(video.id)
        );
        url = full.blobUrl || '';
      } catch {
        // Fall back to empty — validation will surface the error
      }
    }

    form.setValue('mediaUrl', url, { shouldValidate: true });
    form.setValue('mediaType', 'video');
    form.setValue('thumbnailUrl', video.thumbnailUrl ?? '');
    setSelectedVideoId(video.id);
    setSelectedFileName(video.title || 'Untitled video');
    generateContent({
      mediaType: 'video',
      mediaId: video.id,
      contentType: 'social-post',
    });
  };

  const handleSelectAsset = (asset: (typeof assets)[0]) => {
    form.setValue('mediaUrl', asset.blobUrl, { shouldValidate: true });
    form.setValue('mediaType', asset.type === 'video' ? 'video' : 'image');
    form.setValue('thumbnailUrl', asset.thumbnailUrl ?? '');
    setSelectedVideoId(null);
    setSelectedFileName(asset.name);
    generateContent({
      mediaType: asset.type === 'video' ? 'video' : 'image',
      mediaId: asset.id,
      contentType: 'social-post',
    });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFileName(file.name);
    setUploadProgress(0);

    // Auto-detect media type from file
    const isVideo = file.type.startsWith('video/');
    const mediaType = isVideo ? 'video' : 'image';
    form.setValue('mediaType', mediaType);

    try {
      // 1. Upload the file to storage
      const uploadResult = isVideo
        ? await uploadVideo(file)
        : await uploadImage(file);

      // 2. Create an asset record so it appears in the content library
      await createAssetAsync({
        file,
        blobUrl: uploadResult.url,
        type: mediaType,
      });

      setSelectedVideoId(null);
      form.setValue('mediaUrl', uploadResult.url, { shouldValidate: true });
      form.setValue('thumbnailUrl', '');
    } catch {
      setSelectedFileName(null);
      setSelectedVideoId(null);
      form.setValue('mediaUrl', '', { shouldValidate: true });
      form.setValue('thumbnailUrl', '');
    }
  };

  const handleRemoveFile = () => {
    setSelectedFileName(null);
    setUploadProgress(0);
    form.setValue('mediaUrl', '', { shouldValidate: true });
    form.setValue('thumbnailUrl', '');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleSubmit = (data: FormData) => {
    // Pass pageIds directly - backend will derive platforms and platformSettings.
    // The builder owns the date/time → ISO conversion.
    createSocialPost({
      title: data.title,
      caption: data.caption,
      mediaType: data.mediaType,
      mediaUrl: data.mediaUrl,
      thumbnailUrl: data.thumbnailUrl || undefined,
      pageIds: data.pageIds,
      // This surface is the scheduler — it only ever schedules.
      schedule: { mode: 'schedule', date: data.date, time: data.time },
    });
  };

  const selectedPageIds = form.watch('pageIds');
  const watchedCaption = form.watch('caption');
  const watchedMediaUrl = form.watch('mediaUrl');

  // Derive preview platform from the first selected page
  const previewPage = pages.find((p) => selectedPageIds.includes(p.id));
  const previewPlatform: SocialPostPlatform =
    (previewPage?.platform as SocialPostPlatform) ?? 'facebook';
  const previewProfilePage = pages.find(
    (p) => p.platform === previewPlatform && p.isActive
  );

  const togglePage = (pageId: string) => {
    const current = form.getValues('pageIds');
    if (current.includes(pageId)) {
      form.setValue(
        'pageIds',
        current.filter((id) => id !== pageId),
        { shouldValidate: true }
      );
    } else {
      form.setValue('pageIds', [...current, pageId], { shouldValidate: true });
    }
  };

  const getSelectedPagesLabel = () => {
    if (selectedPageIds.length === 0) return 'Select pages...';
    if (selectedPageIds.length === 1) {
      const page = pages.find((p) => p.id === selectedPageIds[0]);
      return page?.pageName || '1 page selected';
    }
    return `${selectedPageIds.length} pages selected`;
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {children && <DialogTrigger asChild>{children}</DialogTrigger>}

      <DialogContent
        className="sm:max-w-4xl max-h-[85vh] overflow-y-auto"
        onInteractOutside={handleInteractOutside}
      >
        <DialogHeader>
          <DialogTitle>Schedule Content</DialogTitle>
          <DialogDescription>
            Schedule a new post for your social media accounts.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[1fr,auto]">
          <form
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-4"
          >
            <Controller
              name="title"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={field.name}>{L.title}</FieldLabel>
                  <Input
                    {...field}
                    id={field.name}
                    placeholder="Enter post title"
                    aria-invalid={fieldState.invalid}
                    data-claire-target="post-title-input"
                  />
                  {fieldState.error && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            <Controller
              name="caption"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor={field.name}>{L.caption}</FieldLabel>
                  <AiFieldWrapper
                    isGenerating={isGenerating}
                    hasGenerated={hasAiGenerated}
                  >
                    <Textarea
                      {...field}
                      id={field.name}
                      placeholder="Enter post caption"
                      rows={3}
                      data-claire-target="post-caption-textarea"
                    />
                  </AiFieldWrapper>
                </Field>
              )}
            />

            {/* Content Picker */}
            <Controller
              name="mediaUrl"
              control={form.control}
              render={({ fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel>{L.mediaUrl}</FieldLabel>

                  {/* Selected content indicator */}
                  {selectedFileName && (
                    <div className="space-y-2 mb-3">
                      <div className="flex items-center gap-2 rounded-md border bg-muted/50 px-3 py-2">
                        {form.watch('mediaType') === 'video' ? (
                          <VideoIcon className="size-4 text-muted-foreground" />
                        ) : (
                          <ImageIcon className="size-4 text-muted-foreground" />
                        )}
                        <span className="flex-1 truncate text-sm">
                          {selectedFileName}
                        </span>
                        {isUploading ? (
                          <Loader2 className="size-4 animate-spin text-muted-foreground" />
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="size-6"
                            onClick={handleRemoveFile}
                          >
                            <XIcon className="size-3" />
                          </Button>
                        )}
                      </div>
                      {isUploading && (
                        <Progress value={uploadProgress} className="h-1" />
                      )}
                    </div>
                  )}

                  {/* Search */}
                  <div className="relative mb-3">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search content..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-9"
                    />
                  </div>

                  {/* Tabs for Created Videos and Uploaded Content */}
                  <Tabs
                    value={activeTab}
                    onValueChange={(v) =>
                      setActiveTab(v as 'videos' | 'assets')
                    }
                    className="w-full"
                    data-claire-target="post-content-picker"
                  >
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger
                        value="videos"
                        className="flex items-center gap-2"
                      >
                        <Film className="h-4 w-4" />
                        Created Videos
                      </TabsTrigger>
                      <TabsTrigger
                        value="assets"
                        className="flex items-center gap-2"
                      >
                        <Upload className="h-4 w-4" />
                        Uploaded Content
                      </TabsTrigger>
                    </TabsList>

                    {/* Created Videos Tab */}
                    <TabsContent value="videos" className="mt-3">
                      {isLoadingVideos ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                      ) : availableVideos.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-6 text-center">
                          <p className="text-sm text-muted-foreground">
                            {searchQuery
                              ? 'No videos match your search'
                              : 'No videos available. Create a video first.'}
                          </p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-3 max-h-[250px] overflow-y-auto p-1">
                          {availableVideos.map((video) => (
                            <button
                              key={video.id}
                              type="button"
                              onClick={() => handleSelectVideo(video)}
                              className={cn(
                                'relative rounded-lg border-2 overflow-hidden transition-all text-left',
                                selectedVideoId === video.id
                                  ? 'border-primary ring-2 ring-primary/20'
                                  : 'border-transparent hover:border-muted-foreground/30'
                              )}
                            >
                              <div className="aspect-video bg-muted relative">
                                {video.thumbnailUrl ? (
                                  <img
                                    src={video.thumbnailUrl}
                                    alt={video.title || 'Video thumbnail'}
                                    className="w-full h-full object-cover"
                                  />
                                ) : video.blobUrl ? (
                                  <video
                                    src={video.blobUrl}
                                    className="w-full h-full object-cover"
                                    muted
                                    playsInline
                                    preload="metadata"
                                    onLoadedData={(e) => {
                                      e.currentTarget.currentTime = 0.001;
                                    }}
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                                    No preview
                                  </div>
                                )}
                                {selectedVideoId === video.id && (
                                  <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                                    <Check className="h-4 w-4" />
                                  </div>
                                )}
                              </div>
                              <div className="p-2">
                                <p className="text-sm font-medium truncate">
                                  {video.title || 'Untitled'}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  {video.durationMs
                                    ? `${Math.round(Number(video.durationMs) / 1000)}s`
                                    : 'Duration unknown'}
                                </p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </TabsContent>

                    {/* Uploaded Content Tab */}
                    <TabsContent value="assets" className="mt-3">
                      {isLoadingAssets ? (
                        <div className="flex items-center justify-center py-12">
                          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                      ) : availableAssets.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-6 text-center">
                          <p className="text-sm text-muted-foreground">
                            {searchQuery
                              ? 'No content matches your search'
                              : 'No uploaded content available.'}
                          </p>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,video/*"
                            onChange={handleFileSelect}
                            className="hidden"
                            disabled={isUploading}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                          >
                            <UploadIcon className="size-4" />
                            Upload New
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-3 max-h-[250px] overflow-y-auto p-1">
                            {availableAssets.map((asset) => (
                              <button
                                key={asset.id}
                                type="button"
                                onClick={() => handleSelectAsset(asset)}
                                className={cn(
                                  'relative rounded-lg border-2 overflow-hidden transition-all text-left',
                                  form.watch('mediaUrl') === asset.blobUrl
                                    ? 'border-primary ring-2 ring-primary/20'
                                    : 'border-transparent hover:border-muted-foreground/30'
                                )}
                              >
                                <div className="aspect-video bg-muted relative">
                                  {asset.type === 'video' ? (
                                    <video
                                      src={asset.blobUrl}
                                      className="w-full h-full object-cover"
                                      muted
                                      playsInline
                                      preload="metadata"
                                      onLoadedData={(e) => {
                                        e.currentTarget.currentTime = 0.001;
                                      }}
                                    />
                                  ) : (
                                    <img
                                      src={asset.blobUrl}
                                      alt={asset.name}
                                      className="w-full h-full object-cover"
                                    />
                                  )}
                                  {form.watch('mediaUrl') === asset.blobUrl && (
                                    <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-1">
                                      <Check className="h-4 w-4" />
                                    </div>
                                  )}
                                </div>
                                <div className="p-2">
                                  <p className="text-sm font-medium truncate">
                                    {asset.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {asset.type === 'video' && asset.duration
                                      ? `${Math.round(Number(asset.duration))}s`
                                      : asset.type === 'image'
                                        ? 'Image'
                                        : 'Duration unknown'}
                                  </p>
                                </div>
                              </button>
                            ))}
                          </div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept="image/*,video/*"
                            onChange={handleFileSelect}
                            className="hidden"
                            disabled={isUploading}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="mt-3 w-full"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                          >
                            <UploadIcon className="size-4" />
                            Upload New
                          </Button>
                        </>
                      )}
                    </TabsContent>
                  </Tabs>

                  {fieldState.error && (
                    <FieldError errors={[fieldState.error]} />
                  )}
                </Field>
              )}
            />

            <Field data-invalid={!!form.formState.errors.pageIds}>
              <FieldLabel>{L.pageIds}</FieldLabel>
              {isPagesLoading ? (
                <div className="h-10 rounded-md border bg-muted/50 animate-pulse" />
              ) : pages.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No connected pages. Connect Meta or Instagram in Settings
                  first.
                </p>
              ) : (
                <Popover
                  open={pagesPopoverOpen}
                  onOpenChange={setPagesPopoverOpen}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={pagesPopoverOpen}
                      className="w-full justify-between"
                      type="button"
                      data-claire-target="post-pages-selector"
                    >
                      <span className="truncate">
                        {getSelectedPagesLabel()}
                      </span>
                      <div className="flex items-center gap-1">
                        {selectedPageIds.length > 0 && (
                          <Badge variant="secondary" className="ml-2">
                            {selectedPageIds.length}
                          </Badge>
                        )}
                      </div>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[300px] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Search pages..." />
                      <CommandList>
                        <CommandEmpty>No pages found.</CommandEmpty>
                        <CommandGroup>
                          {pages.map((page) => (
                            <CommandItem
                              key={page.id}
                              value={page.pageName || page.pageId}
                              onSelect={() => togglePage(page.id)}
                            >
                              <div
                                className={cn(
                                  'mr-2 flex size-4 items-center justify-center rounded-sm border border-primary',
                                  selectedPageIds.includes(page.id)
                                    ? 'bg-primary text-primary-foreground'
                                    : 'opacity-50 [&_svg]:invisible'
                                )}
                              >
                                <CheckIcon className="size-3" />
                              </div>
                              {page.platform === 'facebook' ? (
                                <FacebookIcon className="mr-2 size-4 text-blue-600" />
                              ) : (
                                <InstagramIcon className="mr-2 size-4 text-pink-600" />
                              )}
                              <span className="truncate">
                                {page.pageName || page.pageId}
                              </span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              )}
              {form.formState.errors.pageIds && (
                <FieldError errors={[form.formState.errors.pageIds]} />
              )}
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <Controller
                name="date"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>{L.date}</FieldLabel>
                    <DatePicker
                      id={field.name}
                      placeholder="Select date"
                      value={
                        field.value
                          ? parse(field.value, 'yyyy-MM-dd', new Date())
                          : undefined
                      }
                      onChange={(date) =>
                        field.onChange(date ? format(date, 'yyyy-MM-dd') : '')
                      }
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.error && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />

              <Controller
                name="time"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor={field.name}>{L.time}</FieldLabel>
                    <Input
                      {...field}
                      id={field.name}
                      type="time"
                      aria-invalid={fieldState.invalid}
                    />
                    {fieldState.error && (
                      <FieldError errors={[fieldState.error]} />
                    )}
                  </Field>
                )}
              />
            </div>

            <DialogFooter>
              <Button
                type="submit"
                disabled={isCreating}
                data-claire-target="post-schedule-button"
              >
                <SaveIcon className="size-4" />
                {isCreating ? 'Scheduling...' : 'Schedule Content'}
              </Button>
            </DialogFooter>
          </form>

          {/* Live Preview */}
          <div className="hidden md:flex flex-col items-center pt-2">
            <SocialPostPreview
              platform={previewPlatform}
              imageUrl={watchedMediaUrl || ''}
              caption={watchedCaption || ''}
              profileImageUrl={previewProfilePage?.pagePictureUrl ?? undefined}
              profileName={
                previewProfilePage?.pageUsername ??
                previewProfilePage?.pageName ??
                undefined
              }
              className="w-64"
            />
            <p className="mt-2 text-xs text-muted-foreground">Live Preview</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
