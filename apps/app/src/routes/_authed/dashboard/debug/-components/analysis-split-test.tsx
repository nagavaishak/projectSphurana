import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable';
import { Separator } from '@/components/ui/separator';
import { getAuthToken } from '@/lib/auth-token';
import { resolveApiUrl } from '@/lib/resolve-api-url';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  Globe,
  Loader2,
  Monitor,
  Palette,
  Scissors,
  Type,
} from 'lucide-react';
import { useCallback, useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** From existing /website-analysis/analyze endpoint */
interface AnalyzeWebsiteResponse {
  services: Array<{ name: string; pricingDescription?: string }>;
  targetAudienceDescription: string;
  brandVoice: string[];
  suggestedCredibilityLines: string[];
  primaryColor?: string;
  secondaryColor?: string;
  logoUrl?: string | null;
  locations?: Array<{
    name?: string;
    addressLine1: string;
    city: string;
    county?: string;
    postalCode?: string;
    country: string;
  }>;
  practitioners?: Array<{ name: string; title?: string }>;
}

/** From new /website-analysis/debug-content endpoint */
interface ExtractedService {
  name: string;
  category: string | null;
  price: number | null;
  duration: number | null;
  deposit: number | null;
  priceType: string | null;
  description: string | null;
}

interface ExtractedContent {
  rawHtml: string;
  extractedText: string;
  title: string | null;
  metaDescription: string | null;
  ogTags: Record<string, string>;
  colors: string[];
  logoUrl: string | null;
  socialLinks: Array<{ platform: string; url: string }>;
  fonts: string[];
  bookingLinks: string[];
  jsonLd: unknown[];
  embeddedData: unknown | null;
  services: ExtractedService[];
  durationMs: number;
}

interface NavigationStep {
  action: string;
  url: string;
  reasoning: string;
}

interface DebugContentResponse {
  url: string;
  fetchMethod: ExtractedContent;
  browserMethod: ExtractedContent | null;
  browserError: string | null;
  navigationLog: NavigationStep[];
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

function authHeaders(): HeadersInit {
  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const b = await response.json();
      if (typeof b.message === 'string') message = b.message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    credentials: 'include',
    headers: authHeaders(),
  });
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const b = await response.json();
      if (typeof b.message === 'string') message = b.message;
    } catch {
      /* not JSON */
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

/** Poll a URL until a condition is met or timeout */
async function poll<T>(
  url: string,
  isDone: (data: T) => boolean,
  intervalMs = 2000,
  timeoutMs = 120_000
): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const data = await getJson<T>(url);
    if (isDone(data)) return data;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error('Polling timed out');
}

interface JobStartResponse {
  jobId: string;
}

interface JobStatusResponse {
  status: 'pending' | 'done' | 'error';
  result?: DebugContentResponse;
  error?: string;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface SplitTestState {
  currentMethod: {
    data: AnalyzeWebsiteResponse | null;
    error: string | null;
    loading: boolean;
    durationMs: number | null;
  };
  browserMethod: {
    data: ExtractedContent | null;
    error: string | null;
    loading: boolean;
    navigationLog: NavigationStep[];
  };
}

const initialState: SplitTestState = {
  currentMethod: { data: null, error: null, loading: false, durationMs: null },
  browserMethod: { data: null, error: null, loading: false, navigationLog: [] },
};

export function AnalysisSplitTest() {
  const [url, setUrl] = useState('');
  const [state, setState] = useState<SplitTestState>(initialState);
  const isLoading = state.currentMethod.loading || state.browserMethod.loading;
  const hasData = state.currentMethod.data || state.browserMethod.data;

  const handleAnalyze = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;

    setState({
      currentMethod: {
        data: null,
        error: null,
        loading: true,
        durationMs: null,
      },
      browserMethod: {
        data: null,
        error: null,
        loading: true,
        navigationLog: [],
      },
    });

    const currentStart = Date.now();

    // 1. Current method — existing analyze endpoint (single request)
    postJson<AnalyzeWebsiteResponse>(
      resolveApiUrl('website-analysis/analyze'),
      {
        websiteUrl: trimmed,
        forceRefresh: true,
      }
    )
      .then((data) => {
        setState((prev) => ({
          ...prev,
          currentMethod: {
            data,
            error: null,
            loading: false,
            durationMs: Date.now() - currentStart,
          },
        }));
      })
      .catch((err) => {
        setState((prev) => ({
          ...prev,
          currentMethod: {
            data: null,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
            durationMs: null,
          },
        }));
      });

    // 2. Browser method — start job then poll for result
    postJson<JobStartResponse>(
      resolveApiUrl('website-analysis/debug-content'),
      {
        websiteUrl: trimmed,
      }
    )
      .then(({ jobId }) =>
        poll<JobStatusResponse>(
          resolveApiUrl(`website-analysis/debug-content/${jobId}`),
          (s) => s.status !== 'pending',
          2000,
          120_000
        )
      )
      .then((job) => {
        if (job.status === 'done' && job.result) {
          const resp = job.result;
          setState((prev) => ({
            ...prev,
            browserMethod: {
              data: resp.browserMethod,
              error: resp.browserError,
              loading: false,
              navigationLog: resp.navigationLog || [],
            },
          }));
        } else {
          setState((prev) => ({
            ...prev,
            browserMethod: {
              data: null,
              error: job.error || 'Job failed',
              loading: false,
              navigationLog: [],
            },
          }));
        }
      })
      .catch((err) => {
        setState((prev) => ({
          ...prev,
          browserMethod: {
            data: null,
            error: err instanceof Error ? err.message : String(err),
            loading: false,
            navigationLog: [],
          },
        }));
      });
  }, [url]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAnalyze();
      }
    },
    [handleAnalyze]
  );

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <h1 className="text-2xl font-bold">AI Analysis Split Test</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Compare current GPT-4o analysis (fetch + AI) vs browser-based
          structured extraction (Playwright + DOM parsing).
        </p>
        <div className="flex gap-3">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter website URL (e.g. hivesalon.ie)"
            className="max-w-lg"
            disabled={isLoading}
          />
          <Button onClick={handleAnalyze} disabled={isLoading || !url.trim()}>
            {isLoading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Analyzing...
              </>
            ) : (
              'Analyze'
            )}
          </Button>
        </div>
      </div>

      {/* Split panels */}
      {hasData || isLoading ? (
        <div className="flex-1 overflow-hidden">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel defaultSize={50} minSize={25}>
              <CurrentMethodPanel state={state.currentMethod} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50} minSize={25}>
              <BrowserMethodPanel state={state.browserMethod} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Globe className="size-16 opacity-20" />
          <p className="text-sm">
            Enter a URL above to compare extraction methods
          </p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left panel: Current method (fetch + GPT-4o)
// ---------------------------------------------------------------------------

function CurrentMethodPanel({
  state,
}: {
  state: SplitTestState['currentMethod'];
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <Globe className="size-4" />
            <span className="text-sm font-medium">Current Method</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            fetch() + text extraction + GPT-4o analysis
          </p>
        </div>
        {state.durationMs != null && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {(state.durationMs / 1000).toFixed(1)}s
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {state.loading && (
          <div className="flex flex-col items-center justify-center gap-3 py-20">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              Running AI analysis... this can take 30-60s
            </p>
          </div>
        )}
        {state.error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {state.error}
          </div>
        )}
        {state.data && <CurrentMethodResults data={state.data} />}
      </div>
    </div>
  );
}

function CurrentMethodResults({ data }: { data: AnalyzeWebsiteResponse }) {
  return (
    <div className="space-y-5">
      {/* Services */}
      <Section
        title={`Services (${data.services.length})`}
        icon={<Scissors className="size-3.5" />}
      >
        {data.services.length > 0 ? (
          <div className="space-y-0.5">
            {data.services.map((s) => (
              <div
                key={s.name}
                className="rounded px-2 py-1.5 text-xs odd:bg-muted/30"
              >
                <span className="font-medium">{s.name}</span>
                {s.pricingDescription && (
                  <p className="mt-0.5 text-muted-foreground">
                    {s.pricingDescription}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No services found</p>
        )}
      </Section>

      {/* Colors */}
      <Section title="Brand Colors" icon={<Palette className="size-3.5" />}>
        <div className="flex items-center gap-3">
          {data.primaryColor && (
            <div className="flex items-center gap-1.5">
              <div
                className="size-6 rounded border"
                style={{ backgroundColor: data.primaryColor }}
              />
              <span className="font-mono text-xs">{data.primaryColor}</span>
              <Badge variant="secondary" className="text-[10px]">
                primary
              </Badge>
            </div>
          )}
          {data.secondaryColor && (
            <div className="flex items-center gap-1.5">
              <div
                className="size-6 rounded border"
                style={{ backgroundColor: data.secondaryColor }}
              />
              <span className="font-mono text-xs">{data.secondaryColor}</span>
              <Badge variant="secondary" className="text-[10px]">
                secondary
              </Badge>
            </div>
          )}
        </div>
      </Section>

      {/* Brand Voice */}
      {data.brandVoice.length > 0 && (
        <Section title="Brand Voice">
          <div className="flex flex-wrap gap-1.5">
            {data.brandVoice.map((v) => (
              <Badge key={v} variant="outline" className="text-xs">
                {v}
              </Badge>
            ))}
          </div>
        </Section>
      )}

      {/* Target Audience */}
      {data.targetAudienceDescription && (
        <Section title="Target Audience">
          <p className="text-xs">{data.targetAudienceDescription}</p>
        </Section>
      )}

      {/* Credibility Lines */}
      {data.suggestedCredibilityLines.length > 0 && (
        <Section title="Credibility Lines">
          <ul className="space-y-0.5">
            {data.suggestedCredibilityLines.map((line) => (
              <li key={line} className="text-xs text-muted-foreground">
                &bull; {line}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Practitioners */}
      {data.practitioners && data.practitioners.length > 0 && (
        <Section title={`Practitioners (${data.practitioners.length})`}>
          <div className="space-y-0.5">
            {data.practitioners.map((p) => (
              <div key={p.name} className="text-xs">
                <span className="font-medium">{p.name}</span>
                {p.title && (
                  <span className="text-muted-foreground"> — {p.title}</span>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Locations */}
      {data.locations && data.locations.length > 0 && (
        <Section title={`Locations (${data.locations.length})`}>
          <div className="space-y-1">
            {data.locations.map((loc) => (
              <div key={`${loc.addressLine1}-${loc.city}`} className="text-xs">
                {loc.name && <span className="font-medium">{loc.name}: </span>}
                <span className="text-muted-foreground">
                  {[
                    loc.addressLine1,
                    loc.city,
                    loc.postalCode,
                    loc.country?.toUpperCase(),
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Logo */}
      {data.logoUrl && (
        <Section title="Logo">
          <InfoRow label="URL" value={data.logoUrl} />
        </Section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Right panel: Browser method (Playwright + DOM parsing)
// ---------------------------------------------------------------------------

function BrowserMethodPanel({
  state,
}: {
  state: SplitTestState['browserMethod'];
}) {
  const [activeTab, setActiveTab] = useState<
    'overview' | 'nav' | 'text' | 'html' | 'data'
  >('overview');

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b bg-primary/5 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <Monitor className="size-4" />
            <span className="text-sm font-medium">Browser Method</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Playwright + AI navigation + API interception + DOM extraction
          </p>
        </div>
        {state.data && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3" />
            {(state.data.durationMs / 1000).toFixed(1)}s
          </div>
        )}
      </div>

      {state.loading && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            AI is navigating the website to find services...
          </p>
        </div>
      )}

      {state.error && !state.loading && (
        <div className="p-4">
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
            {state.error}
          </div>
        </div>
      )}

      {state.data && (
        <>
          {/* Tabs */}
          <div className="flex border-b">
            {(
              [
                { key: 'overview', label: 'Overview' },
                {
                  key: 'nav',
                  label: `Navigation (${state.navigationLog.length})`,
                },
                { key: 'text', label: 'Extracted Text' },
                { key: 'html', label: 'Raw HTML' },
                { key: 'data', label: 'Structured Data' },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={cn(
                  'flex-1 px-3 py-2 text-center text-xs font-medium transition-colors',
                  activeTab === key
                    ? 'border-b-2 border-primary text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activeTab === 'overview' && (
              <BrowserOverviewTab content={state.data} />
            )}
            {activeTab === 'nav' && (
              <NavigationLogTab steps={state.navigationLog} />
            )}
            {activeTab === 'text' && (
              <TextTab text={state.data.extractedText} />
            )}
            {activeTab === 'html' && <HtmlTab html={state.data.rawHtml} />}
            {activeTab === 'data' && <DataTab content={state.data} />}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Browser overview tab
// ---------------------------------------------------------------------------

function BrowserOverviewTab({ content }: { content: ExtractedContent }) {
  const servicesByCategory = new Map<string, ExtractedService[]>();
  for (const s of content.services) {
    const cat = s.category || 'Uncategorized';
    const list = servicesByCategory.get(cat) || [];
    list.push(s);
    servicesByCategory.set(cat, list);
  }

  return (
    <div className="space-y-5">
      {/* Services */}
      <Section
        title={`Services Found (${content.services.length})`}
        icon={<Scissors className="size-3.5" />}
      >
        {content.services.length > 0 ? (
          <div className="space-y-3">
            {Array.from(servicesByCategory.entries()).map(
              ([category, items]) => (
                <div key={category}>
                  <p className="mb-1 text-xs font-semibold">{category}</p>
                  <div className="space-y-0.5">
                    {items.map((s) => (
                      <div
                        key={`${s.category}-${s.name}`}
                        className="flex items-center justify-between rounded px-2 py-1 text-xs odd:bg-muted/30"
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {s.name}
                        </span>
                        <div className="ml-3 flex shrink-0 items-center gap-3 text-muted-foreground">
                          {s.price != null && (
                            <span className="font-medium text-foreground">
                              {s.price === 0 ? 'FREE' : `€${s.price}`}
                            </span>
                          )}
                          {s.duration != null && <span>{s.duration}min</span>}
                          {s.deposit != null && s.deposit > 0 && (
                            <span className="text-[10px]">
                              dep €{s.deposit}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-center">
            <p className="text-xs text-muted-foreground">
              No services found in structured data.
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground/70">
              This page may not embed service data in the DOM.
            </p>
          </div>
        )}
      </Section>

      {/* Page Info */}
      <Section title="Page Info">
        <InfoRow label="Title" value={content.title} />
        <InfoRow label="Description" value={content.metaDescription} />
        {content.logoUrl && <InfoRow label="Logo" value={content.logoUrl} />}
      </Section>

      {/* Colors */}
      <Section title="Colors Found" icon={<Palette className="size-3.5" />}>
        {content.colors.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {content.colors.map((color) => (
              <div key={color} className="flex items-center gap-1.5">
                <div
                  className="size-5 rounded border"
                  style={{ backgroundColor: color }}
                />
                <span className="font-mono text-xs">{color}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No colors extracted</p>
        )}
      </Section>

      {/* Fonts */}
      <Section title="Fonts" icon={<Type className="size-3.5" />}>
        {content.fonts.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {content.fonts.map((font) => (
              <span
                key={font}
                className="rounded-md bg-muted px-2 py-0.5 text-xs"
              >
                {font}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No fonts detected</p>
        )}
      </Section>

      {/* Social Links */}
      <Section title="Social Links">
        {content.socialLinks.length > 0 ? (
          <div className="space-y-1">
            {content.socialLinks.map(({ platform, url }) => (
              <div key={url} className="flex items-center gap-2 text-xs">
                <span className="w-16 font-medium capitalize">{platform}</span>
                <span className="truncate font-mono text-muted-foreground">
                  {url}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No social links found</p>
        )}
      </Section>

      {/* Booking Links */}
      <Section title="Booking / Appointment Links">
        {content.bookingLinks.length > 0 ? (
          <div className="space-y-1">
            {content.bookingLinks.map((link) => (
              <p
                key={link}
                className="truncate font-mono text-xs text-muted-foreground"
              >
                {link}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No booking links found
          </p>
        )}
      </Section>

      {/* Stats */}
      <Section title="Content Stats">
        <InfoRow
          label="HTML size"
          value={`${(content.rawHtml.length / 1024).toFixed(1)} KB`}
        />
        <InfoRow
          label="Extracted text"
          value={`${content.extractedText.length.toLocaleString()} chars`}
        />
        <InfoRow label="JSON-LD blocks" value={String(content.jsonLd.length)} />
        <InfoRow
          label="Framework data"
          value={content.embeddedData ? 'Yes' : 'No'}
        />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared tabs
// ---------------------------------------------------------------------------

function TextTab({ text }: { text: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Extracted text content ({text.length.toLocaleString()} chars)
      </p>
      <pre className="max-h-[calc(100vh-20rem)] overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
        {text}
      </pre>
    </div>
  );
}

function HtmlTab({ html }: { html: string }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Raw HTML ({(html.length / 1024).toFixed(1)} KB shown, may be truncated)
      </p>
      <pre className="max-h-[calc(100vh-20rem)] overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed">
        {html}
      </pre>
    </div>
  );
}

function NavigationLogTab({ steps }: { steps: NavigationStep[] }) {
  if (steps.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No navigation steps recorded.
      </p>
    );
  }
  return (
    <div className="space-y-2">
      {steps.map((step, i) => (
        <div key={i} className="rounded-lg border p-3">
          <div className="flex items-center gap-2">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
              {i + 1}
            </span>
            <span className="text-xs font-medium">{step.action}</span>
          </div>
          <p className="mt-1 pl-7 text-xs text-muted-foreground">
            {step.reasoning}
          </p>
          <p className="mt-0.5 pl-7 truncate font-mono text-[10px] text-muted-foreground/60">
            {step.url}
          </p>
        </div>
      ))}
    </div>
  );
}

function DataTab({ content }: { content: ExtractedContent }) {
  return (
    <div className="space-y-4">
      {content.embeddedData != null && (
        <CollapsibleJson
          title="Embedded Framework Data (Livewire / Next.js / Nuxt)"
          data={content.embeddedData}
          defaultOpen
        />
      )}
      {content.jsonLd.length > 0 && (
        <CollapsibleJson
          title={`JSON-LD Structured Data (${content.jsonLd.length} blocks)`}
          data={content.jsonLd}
        />
      )}
      {Object.keys(content.ogTags).length > 0 && (
        <CollapsibleJson title="Open Graph Tags" data={content.ogTags} />
      )}
      {content.embeddedData == null &&
        content.jsonLd.length === 0 &&
        Object.keys(content.ogTags).length === 0 && (
          <p className="text-sm text-muted-foreground">
            No structured data found in the page.
          </p>
        )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI
// ---------------------------------------------------------------------------

function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        {icon}
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="flex gap-2 py-0.5 text-xs">
      <span className="w-24 shrink-0 font-medium text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 break-words">
        {value || <span className="italic text-muted-foreground/50">—</span>}
      </span>
    </div>
  );
}

function CollapsibleJson({
  title,
  data,
  defaultOpen,
}: {
  title: string;
  data: unknown;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen ?? false);

  return (
    <div className="rounded-lg border">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium hover:bg-muted/50"
      >
        {isOpen ? (
          <ChevronDown className="size-3.5" />
        ) : (
          <ChevronRight className="size-3.5" />
        )}
        {title}
      </button>
      {isOpen && (
        <>
          <Separator />
          <pre className="max-h-96 overflow-auto p-3 font-mono text-[10px] leading-relaxed">
            {JSON.stringify(data, null, 2)}
          </pre>
        </>
      )}
    </div>
  );
}
