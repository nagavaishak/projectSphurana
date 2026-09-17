import {
  type AiVoiceId,
  aiVoiceIdValues,
} from '@borradh-workspace/api-client/types';
import {
  type TemplateClipGuidance,
  getTemplateById,
} from '@borradh-workspace/features/videos/templates';
import { useRuntimeConfig } from '@borradh-workspace/runtime-config/client';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import {
  Check,
  ChevronsUpDown,
  ImageIcon,
  Loader2,
  Play,
  Sparkles,
} from 'lucide-react';
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useGenerateOfferCopy } from '@/features/ai-content';
import {
  type Asset,
  useListAssets,
  useListAssetsByService,
} from '@/features/assets';
import { useListOffers } from '@/features/offers';
import {
  useGetActiveOrganization,
  useGetOrganizationBrand,
} from '@/features/organization';
import { useListServices } from '@/features/organization-services';
import { useCreateVideo } from '@/features/videos/api/create-video';
import {
  type GeneratedOrganicCopy,
  type OrganicVariationId,
  useGenerateOrganicCopy,
} from '@/features/videos/api/generate-organic-copy';
import { useGenerateVideoScript } from '@/features/videos/api/generate-video-script';
import { useQueueVideoExport } from '@/features/videos/api/queue-video-export';
import type { VideoDraftConfig } from '@/features/videos/api/types';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';
import { ProcessingModal } from '@/routes/_authed/create-video/$templateId/-components/shared/processing-modal';

interface SlotState {
  /** clipGuidance.order — also the key in clips.templateSlots */
  order: number;
  label: string;
  filterTag?: string;
  recommendedCount: number;
  maxCount: number;
}

export interface GenerateVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templateId: string;
}

const DEFAULT_AI_VOICE: AiVoiceId = aiVoiceIdValues[0];

export function GenerateVideoDialog({
  open,
  onOpenChange,
  templateId,
}: GenerateVideoDialogProps) {
  const navigate = useNavigate();
  const routes = useResolvedRoutes();
  const queryClient = useQueryClient();
  const { cdnUrl } = useRuntimeConfig();

  const template = useMemo(
    () => getTemplateById(templateId) ?? null,
    [templateId]
  );
  const variation = template?.variations[0] ?? null;
  const isOffer = templateId === 'offer';
  const isOrganic = template?.usageType === 'organic';
  // Organic templates render text_only with auto-generated copy — no voiceover.
  const supportsAiVoiceover =
    !isOrganic && template?.supportsAiVoiceover !== false;

  const slots = useMemo<SlotState[]>(() => {
    const guidance: TemplateClipGuidance[] = variation?.clipGuidance ?? [];
    return [...guidance]
      .sort((a, b) => a.order - b.order)
      .map((g) => ({
        order: g.order,
        label: g.label,
        filterTag: g.filterTag,
        recommendedCount: variation?.recommendedClipCount ?? 1,
        maxCount: variation?.maxBRollClips ?? 5,
      }));
  }, [variation]);

  const { data: activeOrg } = useGetActiveOrganization();
  const { brand } = useGetOrganizationBrand(activeOrg?.id ?? '');
  const organizationName = activeOrg?.name ?? null;

  const { services, isLoading: isServicesLoading } = useListServices({
    limit: 100,
  });
  const { offers, isLoading: isOffersLoading } = useListOffers({
    state: 'active',
  });

  const { createVideoAsync, isCreating } = useCreateVideo();
  const { queueExportAsync, isQueuing } = useQueueVideoExport();
  const { generateOfferCopyAsync, isGenerating: isGeneratingOfferCopy } =
    useGenerateOfferCopy();
  const { generateScriptAsync, isGenerating: isGeneratingScript } =
    useGenerateVideoScript();
  const { generateCopyAsync } = useGenerateOrganicCopy();

  // ── Form state ──────────────────────────────────────────────────────
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [useAiVoiceover, setUseAiVoiceover] = useState(supportsAiVoiceover);
  const [allowStockFootage, setAllowStockFootage] = useState(true);
  const [script, setScript] = useState('');
  const [scriptTouched, setScriptTouched] = useState(false);
  const [activeOrder, setActiveOrder] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [processingVideoId, setProcessingVideoId] = useState<string | null>(
    null
  );
  const [selectionsByOrder, setSelectionsByOrder] = useState<
    Record<number, string[]>
  >({});
  const offerCopyRef = useRef<{
    headline: string;
    bulletPoints: string[];
    ctaText: string;
    urgencyText: string;
    audienceText: string;
  } | null>(null);

  // Reset on close + tab default on open
  useEffect(() => {
    if (!open) {
      setServiceId(null);
      setOfferId(null);
      setUseAiVoiceover(supportsAiVoiceover);
      setAllowStockFootage(true);
      setScript('');
      setScriptTouched(false);
      setActiveOrder(null);
      setSelectionsByOrder({});
      setProcessingVideoId(null);
      offerCopyRef.current = null;
      return;
    }
    if (slots.length > 0 && activeOrder === null) {
      setActiveOrder(slots[0].order);
    }
  }, [open, supportsAiVoiceover, slots, activeOrder]);

  // ── Auto-generate script ───────────────────────────────────────────
  // Once a service is picked AND voiceover is on AND user hasn't edited yet.
  useEffect(() => {
    if (!open || !useAiVoiceover || scriptTouched || !serviceId) {
      return;
    }
    if (!variation?.id) return;
    let cancelled = false;
    void generateScriptAsync({
      templateId,
      variationId: variation.id,
      serviceId,
      narrationMode: 'ai_voiceover',
    })
      .then((res) => {
        if (cancelled) return;
        setScript(res.scriptText ?? '');
      })
      .catch((error: Error) => {
        if (cancelled) return;
        toast.error(`Couldn't generate script: ${error.message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    useAiVoiceover,
    scriptTouched,
    serviceId,
    templateId,
    variation,
    generateScriptAsync,
  ]);

  // ── Auto-generate offer copy when an offer is picked ────────────────
  useEffect(() => {
    if (!isOffer || !offerId) {
      offerCopyRef.current = null;
      return;
    }
    let cancelled = false;
    void generateOfferCopyAsync({ offerId })
      .then((copy) => {
        if (cancelled) return;
        offerCopyRef.current = copy;
      })
      .catch(() => {
        // Backend always falls back; ignore.
      });
    return () => {
      cancelled = true;
    };
  }, [isOffer, offerId, generateOfferCopyAsync]);

  // ── Service-sorted offers ──────────────────────────────────────────
  const sortedOffers = useMemo(() => {
    if (!offers.length) return [];
    return [...offers].sort((a, b) => {
      const aLinked = serviceId ? a.serviceIds.includes(serviceId) : false;
      const bLinked = serviceId ? b.serviceIds.includes(serviceId) : false;
      if (aLinked && !bLinked) return -1;
      if (!aLinked && bLinked) return 1;
      return a.name.localeCompare(b.name);
    });
  }, [offers, serviceId]);

  // ── Submit ──────────────────────────────────────────────────────────
  const isBusy = isCreating || isQueuing || isGeneratingScript;
  const canSubmit =
    !!template &&
    !!serviceId &&
    (isOrganic || !useAiVoiceover || script.trim().length > 0) &&
    (!isOffer || !!offerId) &&
    !isBusy;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!template || !serviceId) return;

    setIsSubmitting(true);
    try {
      const bRollClips = slots.flatMap((slot, slotIndex) => {
        const ids = selectionsByOrder[slot.order] ?? [];
        return ids.map((assetId, i) => ({
          assetId,
          order: slotIndex * 100 + i,
          clipType: 'bRoll' as const,
        }));
      });

      const musicTrack = template.musicTracks?.[0];
      const musicUrl = musicTrack
        ? `${cdnUrl ?? ''}${musicTrack.path}`
        : undefined;

      let draftConfig: VideoDraftConfig;
      let title = template.title;

      if (isOrganic) {
        // Organic templates: backend AI writes the on-screen copy from the
        // selected service. We mirror the bulk content-batch shape: text_only
        // narration, no captions, louder music, no outro, one of four config
        // blocks pulled from `generateOrganicCopy`.
        if (!variation?.id) throw new Error('Template has no variation');
        const copy = await generateCopyAsync({
          variationId: variation.id as OrganicVariationId,
          serviceId,
        });
        title = deriveOrganicTitle(copy);
        draftConfig = {
          narrationType: 'text_only',
          bRollClips,
          captions: {
            enabled: false,
            position: 'bottom',
            fontFamily: 'inter',
            fontSize: 64,
            textColor: '#FFFFFF',
            highlightColor: '#FFFFFF',
            backgroundColor: '#000000',
            showBackground: false,
          },
          musicTrackId: musicTrack?.id,
          musicUrl,
          musicVolume: 0.18,
          orientation: 'portrait',
          ...configBlockForOrganicCopy(copy),
        };
      } else {
        const narrationType: 'recorded' | 'ai_voiceover' | 'text_only' =
          useAiVoiceover ? 'ai_voiceover' : 'text_only';
        const offerCopy = offerCopyRef.current;
        draftConfig = {
          narrationType,
          aiVoiceId: useAiVoiceover ? DEFAULT_AI_VOICE : null,
          scriptText: useAiVoiceover ? script : '',
          talkingHeadUrl: null,
          bRollClips,
          captions: {
            enabled: true,
            position: 'bottom',
            fontFamily: 'inter',
            fontSize: 64,
            textColor: '#FFFFFF',
            highlightColor: '#FFFFFF',
            backgroundColor: '#000000',
            showBackground: false,
          },
          musicTrackId: musicTrack?.id,
          musicUrl,
          musicVolume: 0.05,
          outro: {
            businessName: organizationName ?? 'Your Business',
            ctaText: 'Book Now',
            backgroundColor: brand?.primaryColor ?? '#000000',
            backgroundOpacity: 0.7,
            textColor: '#FFFFFF',
            durationSec: 3,
          },
          orientation: isOffer ? 'square' : 'portrait',
          offerCard:
            isOffer && offerCopy
              ? {
                  serviceName: offerCopy.headline,
                  headline: offerCopy.headline,
                  bulletPoints: offerCopy.bulletPoints,
                  ctaText: offerCopy.ctaText || 'Book now',
                  urgencyText: offerCopy.urgencyText || undefined,
                  audienceText: offerCopy.audienceText || undefined,
                  businessName: organizationName ?? undefined,
                  primaryColor: brand?.primaryColor ?? '#007AFF',
                  secondaryColor: brand?.secondaryColor ?? '#FFFFFF',
                }
              : undefined,
        };
      }

      const video = await createVideoAsync({
        title,
        templateId,
        variationId: variation?.id,
        serviceId,
        offerId: offerId ?? undefined,
        draftConfig,
        usageType: isOrganic ? 'organic' : 'ad',
      });
      await queueExportAsync({ videoId: video.id, allowStockFootage });
      queryClient.invalidateQueries({ queryKey: ['videos'] });
      // Hand off to the polling/preview modal — it tracks render progress
      // and shows the finished video with Download / View in Library buttons.
      setProcessingVideoId(video.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      toast.error(`Failed to queue video: ${message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // While submitting OR while the processing modal owns the screen, lock the
  // form: ignore outside clicks, Escape, and the close button. The processing
  // modal owns its own dismissal logic (only allowed when failed).
  const handleOpenChange = (next: boolean) => {
    if (isSubmitting || processingVideoId) return;
    onOpenChange(next);
  };

  const handleProcessingClose = () => {
    setProcessingVideoId(null);
    onOpenChange(false);
  };

  const handleVideoReady = () => {
    setProcessingVideoId(null);
    onOpenChange(false);
    void navigate({ to: routes.content });
  };

  if (!template) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Template not found</DialogTitle>
            <DialogDescription>
              We couldn&apos;t find a template called &quot;{templateId}&quot;.
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  // While the processing modal owns the screen, the form dialog hides so we
  // don't stack two dialogs visually. The parent's `open` prop stays true so
  // GenerateVideoDialog (and the ProcessingModal inside it) stays mounted.
  const formOpen = open && !processingVideoId;

  return (
    <>
      <ProcessingModal
        open={!!processingVideoId}
        videoId={processingVideoId}
        onClose={handleProcessingClose}
        onVideoReady={handleVideoReady}
        readyActionLabel="View in Library"
      />
      <Dialog open={formOpen} onOpenChange={handleOpenChange}>
        <DialogContent
          className="sm:max-w-3xl"
          showCloseButton={!isSubmitting}
          onEscapeKeyDown={(e) => {
            if (isSubmitting) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (isSubmitting) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (isSubmitting) e.preventDefault();
          }}
        >
          {isSubmitting ? (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <Loader2 className="size-10 animate-spin text-primary" />
              <div className="text-center">
                <p className="text-base font-medium">Queueing your video…</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  One sec — we&apos;re sending it to the render queue.
                </p>
              </div>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Generate video — {template.title}</DialogTitle>
                <DialogDescription>{template.description}</DialogDescription>
              </DialogHeader>

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div className="grid gap-2">
                  <Label>Service</Label>
                  <ServiceCombobox
                    services={services.map((s) => ({ id: s.id, name: s.name }))}
                    value={serviceId}
                    isLoading={isServicesLoading}
                    onChange={setServiceId}
                  />
                </div>

                {isOffer && (
                  <div className="grid gap-2">
                    <Label>Offer</Label>
                    <OfferCombobox
                      offers={sortedOffers.map((o) => ({
                        id: o.id,
                        name: o.name,
                        code: o.code ?? null,
                      }))}
                      value={offerId}
                      isLoading={isOffersLoading}
                      onChange={setOfferId}
                    />
                    {isGeneratingOfferCopy && (
                      <p className="text-xs text-muted-foreground">
                        Generating offer copy…
                      </p>
                    )}
                  </div>
                )}

                {supportsAiVoiceover && (
                  <div className="flex items-center justify-between rounded-md border p-3">
                    <div className="flex flex-col">
                      <Label htmlFor="ai-voiceover-toggle" className="text-sm">
                        AI voiceover
                      </Label>
                      <span className="text-xs text-muted-foreground">
                        Generate a script and narrate it with an AI voice.
                      </span>
                    </div>
                    <Switch
                      id="ai-voiceover-toggle"
                      checked={useAiVoiceover}
                      onCheckedChange={(checked) => {
                        setUseAiVoiceover(checked);
                        if (!checked) setScript('');
                      }}
                    />
                  </div>
                )}

                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="flex flex-col">
                    <Label htmlFor="stock-footage-toggle" className="text-sm">
                      Use curated stock footage
                    </Label>
                    <span className="text-xs text-muted-foreground">
                      When no footage is uploaded for this service, fill the
                      video with relevant licensed stock clips.
                    </span>
                  </div>
                  <Switch
                    id="stock-footage-toggle"
                    checked={allowStockFootage}
                    onCheckedChange={setAllowStockFootage}
                  />
                </div>

                {serviceId && useAiVoiceover && (
                  <div className="grid gap-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="script">AI voiceover script</Label>
                      {isGeneratingScript && (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Loader2 className="size-3 animate-spin" />
                          Generating…
                        </span>
                      )}
                    </div>
                    <Textarea
                      id="script"
                      value={script}
                      onChange={(e) => {
                        setScript(e.target.value);
                        setScriptTouched(true);
                      }}
                      placeholder="Script will populate once generated. Edit freely."
                      rows={6}
                    />
                  </div>
                )}

                {serviceId && slots.length > 0 && activeOrder !== null && (
                  <div className="grid gap-3">
                    <Label>Footage</Label>
                    <Tabs
                      value={String(activeOrder)}
                      onValueChange={(v) => setActiveOrder(Number(v))}
                    >
                      <TabsList className="flex flex-wrap">
                        {slots.map((slot) => {
                          const count =
                            selectionsByOrder[slot.order]?.length ?? 0;
                          return (
                            <TabsTrigger
                              key={slot.order}
                              value={String(slot.order)}
                            >
                              {slot.label}
                              {count > 0 && (
                                <Badge
                                  variant="secondary"
                                  className="ml-2 h-4 px-1 text-[10px]"
                                >
                                  {count}
                                </Badge>
                              )}
                            </TabsTrigger>
                          );
                        })}
                      </TabsList>
                    </Tabs>
                    {/* Render every slot grid (hide inactive) so each runs its
                  auto-select effect immediately rather than waiting for the
                  user to click into the tab. */}
                    {slots.map((slot) => (
                      <div
                        key={slot.order}
                        className={cn(slot.order !== activeOrder && 'hidden')}
                      >
                        <SlotAssetGrid
                          slot={slot}
                          serviceId={serviceId}
                          selectedIds={selectionsByOrder[slot.order] ?? []}
                          onChange={(ids) =>
                            setSelectionsByOrder((prev) => ({
                              ...prev,
                              [slot.order]: ids,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    disabled={isBusy}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={!canSubmit}>
                    {isBusy ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        Generating…
                      </>
                    ) : (
                      <>
                        <Sparkles className="size-4" />
                        Generate
                      </>
                    )}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Service combobox ──────────────────────────────────────────────────

function ServiceCombobox({
  services,
  value,
  isLoading,
  onChange,
}: {
  services: { id: string; name: string }[];
  value: string | null;
  isLoading: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = services.find((s) => s.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          <span className={cn(!selected && 'text-muted-foreground')}>
            {selected
              ? selected.name
              : isLoading
                ? 'Loading services…'
                : 'Search and select a service'}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Search services…" />
          <CommandList>
            <CommandEmpty>No services found.</CommandEmpty>
            <CommandGroup>
              {services.map((service) => (
                <CommandItem
                  key={service.id}
                  value={service.name}
                  onSelect={() => {
                    onChange(service.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4',
                      value === service.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  {service.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Offer combobox ────────────────────────────────────────────────────

function OfferCombobox({
  offers,
  value,
  isLoading,
  onChange,
}: {
  offers: { id: string; name: string; code: string | null }[];
  value: string | null;
  isLoading: boolean;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = offers.find((o) => o.id === value) ?? null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between"
        >
          <span className={cn(!selected && 'text-muted-foreground')}>
            {selected
              ? selected.name
              : isLoading
                ? 'Loading offers…'
                : 'Search and select an offer'}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder="Search offers…" />
          <CommandList>
            <CommandEmpty>No offers found.</CommandEmpty>
            <CommandGroup>
              {offers.map((offer) => (
                <CommandItem
                  key={offer.id}
                  value={offer.name}
                  onSelect={() => {
                    onChange(offer.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4',
                      value === offer.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="flex-1">{offer.name}</span>
                  {offer.code && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {offer.code}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

// ── Per-slot asset grid ───────────────────────────────────────────────

function SlotAssetGrid({
  slot,
  serviceId,
  selectedIds,
  onChange,
}: {
  slot: SlotState;
  serviceId: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const tags = slot.filterTag ? [slot.filterTag] : undefined;
  const { assets: tagAssets, isLoading: isTagLoading } = useListAssets({
    tags,
    type: 'video',
  });
  const { assets: serviceAssets, isLoading: isServiceLoading } =
    useListAssetsByService(serviceId ?? '');

  // Merge: service-linked first (deduped), then the rest of the tag-filtered set.
  const merged = useMemo<Asset[]>(() => {
    const serviceFiltered = (serviceAssets ?? []).filter((a) => {
      if (a.type !== 'video') return false;
      if (!slot.filterTag) return true;
      return (a.tags ?? []).includes(slot.filterTag);
    });
    const seen = new Set(serviceFiltered.map((a) => a.id));
    const rest = (tagAssets ?? []).filter((a) => !seen.has(a.id));
    return [...serviceFiltered, ...rest];
  }, [serviceAssets, tagAssets, slot.filterTag]);

  // Auto-preselect first N for this slot the first time assets arrive.
  const hasAutoSelected = useRef(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the auto-select gate only when the slot changes
  useEffect(() => {
    hasAutoSelected.current = false;
  }, [slot.order, serviceId]);
  useEffect(() => {
    if (hasAutoSelected.current) return;
    if (isTagLoading || isServiceLoading) return;
    if (merged.length === 0) return;
    if (selectedIds.length > 0) {
      hasAutoSelected.current = true;
      return;
    }
    const pick = merged
      .slice(0, Math.min(slot.recommendedCount, slot.maxCount))
      .map((a) => a.id);
    onChange(pick);
    hasAutoSelected.current = true;
  }, [
    merged,
    isTagLoading,
    isServiceLoading,
    selectedIds.length,
    slot.recommendedCount,
    slot.maxCount,
    onChange,
  ]);

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      onChange(selectedIds.filter((x) => x !== id));
      return;
    }
    if (selectedIds.length >= slot.maxCount) {
      // Replace oldest selection so the user can keep clicking without resetting.
      onChange([...selectedIds.slice(1), id]);
      return;
    }
    onChange([...selectedIds, id]);
  };

  if (isTagLoading || isServiceLoading) {
    return (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    );
  }

  if (merged.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-8 text-center">
        <ImageIcon className="size-6 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          No {slot.label.toLowerCase()} clips yet. Upload videos and tag them
          with{' '}
          {slot.filterTag ? (
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              {slot.filterTag}
            </code>
          ) : (
            'the matching type'
          )}
          .
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-2 text-xs text-muted-foreground">
        {selectedIds.length} of {slot.maxCount} selected
      </p>
      <div className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4 md:grid-cols-5">
        {merged.map((asset) => (
          <AssetTile
            key={asset.id}
            asset={asset}
            selected={selectedIds.includes(asset.id)}
            onClick={() => toggle(asset.id)}
          />
        ))}
      </div>
    </div>
  );
}

function AssetTile({
  asset,
  selected,
  onClick,
}: {
  asset: Asset;
  selected: boolean;
  onClick: () => void;
}) {
  const thumb =
    asset.thumbnailUrl ?? (asset.type === 'image' ? asset.blobUrl : null);
  return (
    <button
      type="button"
      onClick={onClick}
      title={asset.name}
      className={cn(
        'group relative aspect-square overflow-hidden rounded-md border bg-muted text-left transition-all',
        selected
          ? 'border-primary ring-2 ring-primary'
          : 'border-transparent hover:border-border'
      )}
    >
      {thumb ? (
        <img src={thumb} alt={asset.name} className="size-full object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Play className="size-5" />
        </div>
      )}
      {selected && (
        <div className="absolute right-1 top-1 rounded-full bg-primary p-0.5 text-primary-foreground">
          <Check className="size-3" />
        </div>
      )}
    </button>
  );
}

// ── Organic copy helpers ──────────────────────────────────────────────

function configBlockForOrganicCopy(
  copy: GeneratedOrganicCopy
): Partial<VideoDraftConfig> {
  switch (copy.kind) {
    case 'caption-tease':
      return { captionTease: copy.config };
    case 'fade-benefits':
      return { fadeBenefits: copy.config };
    case 'highlight-caption':
      return { fadeBenefits: { lines: copy.config.lines, highlight: true } };
    case 'aesthetic-line':
      return { aestheticLine: copy.config };
    case 'numbered-list':
      return { numberedList: copy.config };
    case 'ins-outs':
      return { insOuts: copy.config };
    case 'question-cta':
      return { questionCta: copy.config };
    case 'curiosity-hook':
      return { questionCta: copy.config };
    case 'improves':
      return { improves: copy.config };
    case 'step-timer':
      return { stepTimer: copy.config };
    case 'time-progress':
      return { timeProgress: copy.config };
    case 'poll':
      return { poll: copy.config };
    case 'myth-fact':
      return { mythFact: copy.config };
    case 'versus':
      return { versus: copy.config };
    case 'price-reveal':
      return { priceReveal: copy.config };
    case 'client-question':
      return { clientQuestion: copy.config };
    case 'come-with-me':
      return { comeWithMe: copy.config };
  }
}

function deriveOrganicTitle(copy: GeneratedOrganicCopy): string {
  const truncate = (s: string, max = 80) => {
    const t = s.trim();
    return t.length <= max ? t : `${t.slice(0, max - 1)}…`;
  };
  switch (copy.kind) {
    case 'caption-tease':
      return truncate(copy.config.headline) || 'Caption tease';
    case 'fade-benefits':
      return truncate(copy.config.lines[0]) || 'Fade-in benefits';
    case 'highlight-caption':
      return truncate(copy.config.lines[0]) || 'Highlight caption';
    case 'aesthetic-line':
      return truncate(copy.config.text) || 'Aesthetic line';
    case 'numbered-list':
      return truncate(copy.config.title) || 'Numbered list';
    case 'ins-outs':
      return truncate(copy.config.title) || 'INS + OUTS';
    case 'question-cta':
      return truncate(copy.config.question) || 'Question + Read caption';
    case 'curiosity-hook':
      return truncate(copy.config.question) || 'Curiosity hook';
    case 'improves':
      return `${copy.config.serviceName} improves`;
    case 'step-timer':
      return truncate(copy.config.title) || 'Step + Timer';
    case 'time-progress':
      return truncate(copy.config.caption) || 'Time-lapse progress';
    case 'poll':
      return truncate(copy.config.question) || 'Poll';
    case 'myth-fact':
      return truncate(copy.config.pairs[0]?.myth ?? '') || 'Myth → Fact';
    case 'versus':
      return `${copy.config.treatmentA} vs ${copy.config.treatmentB}`;
    case 'price-reveal':
      return truncate(copy.config.hook) || 'Price reveal';
    case 'client-question':
      return truncate(copy.config.question) || 'Client question';
    case 'come-with-me':
      return truncate(copy.config.title) || 'Come with me';
  }
}
