import { Link } from '@tanstack/react-router';
import {
  Check,
  ChevronsUpDown,
  ImageUp,
  Loader2,
  Sparkles,
} from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from '@/components/ui/field';
import { Label } from '@/components/ui/label';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  generateGraphicForm,
  pickRandomGraphicCategory,
  useGenerateGraphic,
} from '@/features/graphics/api/generate-graphic';
import { useListGraphicTemplates } from '@/features/graphics/api/list-graphic-templates';
import { useListOffers } from '@/features/offers';
import { useListServices } from '@/features/organization-services';
import { useResolvedRoutes } from '@/lib/use-routes';
import { cn } from '@/lib/utils';

import { GraphicProcessingModal } from './graphic-processing-modal';

export interface GenerateGraphicDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Preselect a curated style (template slug) when the dialog opens — set by
   * the Quick Create / content-create template pickers. The format tab follows
   * the template's kind. The user can still change or clear it in the dialog.
   */
  initialTemplateSlug?: string | null;
}

type GraphicKind = 'carousel' | 'single';

/** The one declaration of this form's fields — labels, defaults, controls. */
const L = generateGraphicForm.labels;
const D = generateGraphicForm.defaults;

/**
 * "Generate a graphic" dialog.
 *
 * Single step — service combobox + a Tabs (Carousel / Single) format row.
 * The editorial category is picked for the user: on submit we choose a
 * random category that has a template of the selected format. A tab whose
 * total count across categories is 0 is disabled.
 *
 * On submit we POST `{ serviceId, category, kind }` to /graphics/generate
 * and hand the returned graphic id to `GraphicProcessingModal` for polling.
 */
export function GenerateGraphicDialog({
  open,
  onOpenChange,
  initialTemplateSlug,
}: GenerateGraphicDialogProps) {
  const routes = useResolvedRoutes();
  const [usageType, setUsageType] = useState<'organic' | 'ad'>(D.usageType);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [kind, setKind] = useState<GraphicKind | null>(null);
  const [allowAiImages, setAllowAiImages] = useState(D.allowAiImages);
  // Opt into curated stock photos for slots with no matching service media
  // (default on; behaviour unchanged unless turned off).
  const [allowStockImages, setAllowStockImages] = useState(D.allowStockImages);
  // Optional free-text steer for the generated graphic — the same affordance
  // the new-post-dialog offers. Without it this surface could not build the
  // body the other surface builds.
  const [instruction, setInstruction] = useState(D.refinementInstruction ?? '');
  // Curated style (template slug); null = "Surprise me" (server rotation).
  const [templateSlug, setTemplateSlug] = useState<string | null>(null);
  const [pollingGraphicId, setPollingGraphicId] = useState<string | null>(null);

  const isAd = usageType === 'ad';

  const { templates: styleTemplates } = useListGraphicTemplates('organic');

  // Apply a picker-provided style once per open — the format tab follows the
  // template's kind. The user can still change or clear it afterwards.
  const appliedInitialSlugRef = useRef(false);
  useEffect(() => {
    if (!open) {
      appliedInitialSlugRef.current = false;
      return;
    }
    if (appliedInitialSlugRef.current || !initialTemplateSlug) return;
    const t = styleTemplates.find((s) => s.slug === initialTemplateSlug);
    if (!t) return; // templates not loaded yet — retry on next render
    appliedInitialSlugRef.current = true;
    setUsageType('organic');
    setKind(t.kind);
    setTemplateSlug(t.slug);
  }, [open, initialTemplateSlug, styleTemplates]);

  const { services, isLoading: isServicesLoading } = useListServices({
    limit: 100,
  });
  const { offers, isLoading: isOffersLoading } = useListOffers({
    state: 'active',
  });

  // Show EVERY service. A service without uploaded media is still valid — it
  // just renders with AI images (auto-enabled on selection, below). Filtering
  // these out left orgs with many services seeing "only a couple".
  const selectableServices = services;

  // A graphic for a service with no uploaded media can only be AI-generated, so
  // flip AI on automatically when such a service is picked.
  const handleServiceChange = (id: string) => {
    setServiceId(id);
    if (!allowAiImages) {
      const svc = services.find((s) => s.id === id);
      if (svc && !svc.hasGraphicMedia) {
        setAllowAiImages(true);
        toast.info(
          'No photos uploaded for this service yet — using AI images.'
        );
      }
    }
  };

  // Never send a request that can't render: if the chosen service has no media,
  // AI is required regardless of the toggle.
  const selectedServiceHasMedia = serviceId
    ? (services.find((s) => s.id === serviceId)?.hasGraphicMedia ?? true)
    : true;
  const effectiveAllowAiImages = allowAiImages || !selectedServiceHasMedia;

  const effectiveKind = kind ?? D.kind;

  // Styles are per-format; switching the tab drops an incompatible pick.
  const styleOptions = styleTemplates.filter((t) => t.kind === effectiveKind);
  const selectedStyle =
    styleOptions.find((t) => t.slug === templateSlug) ?? null;

  const handleKindChange = (next: GraphicKind) => {
    setKind(next);
    setTemplateSlug(null);
  };

  const resetForm = () => {
    setUsageType(D.usageType);
    setServiceId(null);
    setOfferId(null);
    setKind(null);
    setAllowAiImages(D.allowAiImages);
    setAllowStockImages(D.allowStockImages);
    setInstruction(D.refinementInstruction ?? '');
    setTemplateSlug(null);
  };

  // Prefer offers linked to the chosen service, then alphabetical.
  const sortedOffers = [...offers].sort((a, b) => {
    const aLinked = serviceId ? a.serviceIds.includes(serviceId) : false;
    const bLinked = serviceId ? b.serviceIds.includes(serviceId) : false;
    if (aLinked && !bLinked) return -1;
    if (!aLinked && bLinked) return 1;
    return a.name.localeCompare(b.name);
  });

  const { generateGraphicAsync, isGenerating } = useGenerateGraphic({
    onSuccess: (g) => {
      resetForm();
      onOpenChange(false);
      setPollingGraphicId(g.id);
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (isGenerating) return;
    if (!next) resetForm();
    onOpenChange(next);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!serviceId) return;
    try {
      if (isAd) {
        if (!offerId) return;
        // Paid offer ad: single image, server composes copy from the offer.
        await generateGraphicAsync({
          serviceId,
          usageType: 'ad',
          offerId,
          allowAiImages: effectiveAllowAiImages,
          allowStockImages,
          refinementInstruction: instruction.trim() || undefined,
        });
      } else {
        const category = pickRandomGraphicCategory();
        if (!category) return;
        await generateGraphicAsync({
          serviceId,
          usageType: 'organic',
          category,
          kind: effectiveKind,
          allowAiImages: effectiveAllowAiImages,
          allowStockImages,
          refinementInstruction: instruction.trim() || undefined,
          // Only send a style the current format actually offers.
          ...(selectedStyle ? { templateSlug: selectedStyle.slug } : {}),
        });
      }
    } catch {
      // Toast already surfaced by the hook.
    }
  };

  const canSubmit = !!serviceId && (!isAd || !!offerId) && !isGenerating;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="sm:max-w-lg"
          showCloseButton={!isGenerating}
          onEscapeKeyDown={(e) => {
            if (isGenerating) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (isGenerating) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            if (isGenerating) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Generate a graphic</DialogTitle>
            <DialogDescription>
              {isAd
                ? 'Design an offer ad from a service and an offer.'
                : 'Pick a service and format.'}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <div className="grid gap-2">
              <Label>{L.usageType}</Label>
              <RadioGroup
                aria-label={L.usageType}
                value={usageType}
                onValueChange={(v) => {
                  const next = v as 'organic' | 'ad';
                  setUsageType(next);
                  if (next === 'organic') setOfferId(null);
                }}
                className="grid gap-3 sm:grid-cols-2"
              >
                <FieldLabel htmlFor="gg-organic">
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>Organic post</FieldTitle>
                      <FieldDescription>
                        A normal social post for your feed.
                      </FieldDescription>
                    </FieldContent>
                    <RadioGroupItem value="organic" id="gg-organic" />
                  </Field>
                </FieldLabel>
                <FieldLabel htmlFor="gg-ad">
                  <Field orientation="horizontal">
                    <FieldContent>
                      <FieldTitle>Paid ad</FieldTitle>
                      <FieldDescription>
                        An offer ad with a price/discount, to advertise.
                      </FieldDescription>
                    </FieldContent>
                    <RadioGroupItem value="ad" id="gg-ad" />
                  </Field>
                </FieldLabel>
              </RadioGroup>
            </div>

            <div className="grid gap-2">
              <Label>{L.serviceId}</Label>
              {!isServicesLoading && selectableServices.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  <p>
                    You don’t have any services yet. Add one under Catalog, then
                    come back to make a graphic.
                  </p>
                  <Button asChild variant="outline" size="sm" className="mt-3">
                    <Link
                      to={routes.contentGallery}
                      onClick={() => onOpenChange(false)}
                    >
                      <ImageUp className="size-4" />
                      Upload media
                    </Link>
                  </Button>
                </div>
              ) : (
                <SearchCombobox
                  items={selectableServices.map((s) => ({
                    id: s.id,
                    name: s.name,
                    hint: !s.hasGraphicMedia ? 'AI' : undefined,
                  }))}
                  value={serviceId}
                  isLoading={isServicesLoading}
                  onChange={handleServiceChange}
                  placeholder="Search and select a service"
                  loadingText="Loading services…"
                  emptyText="No services found."
                />
              )}
            </div>

            {isAd && (
              <div className="grid gap-2">
                <Label>Offer</Label>
                {!isOffersLoading && sortedOffers.length === 0 ? (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    You don’t have any active offers yet. Create one under
                    Promotions, then come back to make the ad.
                  </div>
                ) : (
                  <SearchCombobox
                    items={sortedOffers.map((o) => ({
                      id: o.id,
                      name: o.name,
                    }))}
                    value={offerId}
                    isLoading={isOffersLoading}
                    onChange={setOfferId}
                    placeholder="Search and select an offer"
                    loadingText="Loading offers…"
                    emptyText="No offers found."
                  />
                )}
              </div>
            )}

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="grid gap-0.5">
                <Label htmlFor="allow-ai-images">{L.allowAiImages}</Label>
                <p className="text-xs text-muted-foreground">
                  Off: we use the photos and clips you've uploaded for the
                  service. On: gaps are filled with AI images.
                </p>
              </div>
              <Switch
                id="allow-ai-images"
                checked={allowAiImages}
                onCheckedChange={setAllowAiImages}
                disabled={isGenerating}
              />
            </div>

            <div className="flex items-start justify-between gap-4 rounded-md border p-3">
              <div className="grid gap-0.5">
                <Label htmlFor="allow-stock-images">{L.allowStockImages}</Label>
                <p className="text-xs text-muted-foreground">
                  When no photo is uploaded for this service, fill slots with
                  relevant licensed stock images.
                </p>
              </div>
              <Switch
                id="allow-stock-images"
                checked={allowStockImages}
                onCheckedChange={setAllowStockImages}
                disabled={isGenerating}
              />
            </div>

            {/* Paid ads are always a single image — only organic posts choose
                carousel vs single. */}
            {!isAd && (
              <div className="grid gap-2">
                <Label>{L.kind}</Label>
                <KindTabs value={effectiveKind} onChange={handleKindChange} />
              </div>
            )}

            {/* Curated style for the chosen format. "Surprise me" keeps the
                server-side rotation (the pre-picker behaviour). */}
            {!isAd && styleOptions.length > 0 && (
              <div className="grid gap-2">
                <Label>Style</Label>
                <Select
                  value={templateSlug ?? 'auto'}
                  onValueChange={(v) =>
                    setTemplateSlug(v === 'auto' ? null : v)
                  }
                  disabled={isGenerating}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Surprise me" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Surprise me</SelectItem>
                    {styleOptions.map((t) => (
                      <SelectItem key={t.slug} value={t.slug}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedStyle && (
                  <p className="text-xs text-muted-foreground">
                    {selectedStyle.description}
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-1.5">
              <Label htmlFor="graphic-instruction">
                {L.refinementInstruction}
              </Label>
              <Textarea
                id="graphic-instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="e.g. minimal style, lead with the price, bright colours…"
                disabled={isGenerating}
              />
              <p className="text-xs text-muted-foreground">
                We&apos;ll factor this into what we generate.
              </p>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => handleOpenChange(false)}
                disabled={isGenerating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!canSubmit}>
                {isGenerating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    Starting…
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
        </DialogContent>
      </Dialog>

      <GraphicProcessingModal
        open={!!pollingGraphicId}
        graphicId={pollingGraphicId}
        onClose={() => setPollingGraphicId(null)}
      />
    </>
  );
}

// ── Format tabs ──────────────────────────────────────────────────────────

function KindTabs({
  value,
  onChange,
}: {
  value: GraphicKind;
  onChange: (kind: GraphicKind) => void;
}) {
  return (
    <Tabs value={value} onValueChange={(v) => onChange(v as GraphicKind)}>
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="carousel">Carousel</TabsTrigger>
        <TabsTrigger value="single">Single</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

// ── Search combobox ─────────────────────────────────────────────────────
// Generic on purpose: the offer picker used to render the SERVICE combobox
// verbatim, so it told the user to "Search and select a service" while it was
// listing offers.

function SearchCombobox({
  items,
  value,
  isLoading,
  onChange,
  placeholder,
  loadingText,
  emptyText,
}: {
  items: { id: string; name: string; hint?: string }[];
  value: string | null;
  isLoading: boolean;
  onChange: (id: string) => void;
  placeholder: string;
  loadingText: string;
  emptyText: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = items.find((item) => item.id === value) ?? null;

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
            {selected ? selected.name : isLoading ? loadingText : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command>
          <CommandInput placeholder={placeholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.name}
                  onSelect={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      'mr-2 size-4',
                      value === item.id ? 'opacity-100' : 'opacity-0'
                    )}
                  />
                  <span className="flex-1">{item.name}</span>
                  {item.hint && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {item.hint}
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
