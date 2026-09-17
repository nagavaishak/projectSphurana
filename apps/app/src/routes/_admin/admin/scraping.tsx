import { apiClient } from '@borradh-workspace/api-client';
import type {
  AnalyzeWebsiteInput,
  AnalyzeWebsiteResponse,
} from '@borradh-workspace/api-client/types';
import { createFileRoute } from '@tanstack/react-router';
import {
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  Clock,
  Globe,
  Loader2,
  MapPin,
  Palette,
  Quote,
  Search,
  Sparkles,
  Tag,
  Users,
  XCircle,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

export const Route = createFileRoute('/_admin/admin/scraping')({
  component: ScrapingPage,
});

type Phase =
  | 'idle'
  | 'fetching'
  | 'discovering'
  | 'analyzing'
  | 'done'
  | 'error';

interface JobStatus {
  status: 'pending' | 'done' | 'error';
  phase: Phase;
  result?: AnalyzeWebsiteResponse;
  error?: string;
}

function ScrapingPage() {
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [bookingSystemUrl, setBookingSystemUrl] = useState('');
  const [facebookPageUrl, setFacebookPageUrl] = useState('');
  const [forceRefresh, setForceRefresh] = useState(false);

  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<AnalyzeWebsiteResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [debugJobId, setDebugJobId] = useState<string | null>(null);
  const [debugPhase, setDebugPhase] = useState<Phase>('idle');
  const [debugResult, setDebugResult] = useState<unknown>(null);
  const [debugError, setDebugError] = useState<string | null>(null);

  const isRunning = phase !== 'idle' && phase !== 'done' && phase !== 'error';
  const isDebugRunning =
    debugPhase !== 'idle' && debugPhase !== 'done' && debugPhase !== 'error';
  const isAnyRunning = isRunning || isDebugRunning;

  async function runAnalysis() {
    if (!websiteUrl.trim()) {
      toast.error('Enter a website URL');
      return;
    }

    setPhase('fetching');
    setResult(null);
    setError(null);

    try {
      const input: AnalyzeWebsiteInput = {
        websiteUrl: websiteUrl.trim(),
        forceRefresh,
      };
      if (bookingSystemUrl.trim())
        input.bookingSystemUrl = bookingSystemUrl.trim();
      if (facebookPageUrl.trim())
        input.facebookPageUrl = facebookPageUrl.trim();

      const { jobId } = await apiClient.post<{ jobId: string }>(
        'website-analysis/analyze/start',
        input
      );

      let status: JobStatus | null = null;
      while (true) {
        await new Promise((r) => setTimeout(r, 2000));
        status = await apiClient.get<JobStatus>(
          `website-analysis/analyze/${jobId}`
        );
        setPhase(status.phase ?? 'fetching');
        if (status.status === 'done' || status.status === 'error') break;
      }

      if (status?.status === 'done' && status.result) {
        setResult(status.result);
        setPhase('done');
        toast.success('Analysis complete');
      } else {
        setError(status?.error ?? 'Unknown error');
        setPhase('error');
        toast.error(status?.error ?? 'Analysis failed');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setError(msg);
      setPhase('error');
      toast.error(msg);
    }
  }

  async function runDebugContent() {
    if (!websiteUrl.trim()) {
      toast.error('Enter a website URL');
      return;
    }

    setDebugPhase('fetching');
    setDebugResult(null);
    setDebugError(null);
    setDebugJobId(null);

    try {
      const { jobId } = await apiClient.post<{ jobId: string }>(
        'website-analysis/debug-content',
        { websiteUrl: websiteUrl.trim() }
      );
      setDebugJobId(jobId);

      while (true) {
        await new Promise((r) => setTimeout(r, 2000));
        const status = await apiClient.get<{
          status: string;
          result?: unknown;
          error?: string;
        }>(`website-analysis/debug-content/${jobId}`);

        if (status.status === 'done') {
          setDebugResult(status.result);
          setDebugPhase('done');
          toast.success('Debug content complete');
          break;
        }
        if (status.status === 'error') {
          setDebugError(status.error ?? 'Unknown error');
          setDebugPhase('error');
          toast.error(status.error ?? 'Debug content failed');
          break;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Request failed';
      setDebugError(msg);
      setDebugPhase('error');
      toast.error(msg);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
            <Search className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Website Scraping Test
            </h1>
            <p className="text-sm text-muted-foreground">
              Admin tool — runs the full website analysis pipeline (native +
              enriched strategies)
            </p>
          </div>
        </div>
      </div>

      {/* Input Card */}
      <div className="mb-8 rounded-xl border bg-card shadow-sm">
        <div className="border-b px-6 py-4">
          <h2 className="text-base font-semibold">Configuration</h2>
        </div>
        <div className="space-y-5 p-6">
          <InputField
            id="websiteUrl"
            label="Website URL"
            placeholder="https://www.example-salon.com"
            value={websiteUrl}
            onChange={setWebsiteUrl}
            disabled={isAnyRunning}
            icon={<Globe className="h-4 w-4 text-muted-foreground" />}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <InputField
              id="bookingSystemUrl"
              label="Booking System URL"
              placeholder="https://www.fresha.com/book-now/your-salon"
              value={bookingSystemUrl}
              onChange={setBookingSystemUrl}
              disabled={isAnyRunning}
              optional
            />
            <InputField
              id="facebookPageUrl"
              label="Facebook Page URL"
              placeholder="https://www.facebook.com/yoursalon"
              value={facebookPageUrl}
              onChange={setFacebookPageUrl}
              disabled={isAnyRunning}
              optional
            />
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              id="forceRefresh"
              type="checkbox"
              checked={forceRefresh}
              onChange={(e) => setForceRefresh(e.target.checked)}
              disabled={isAnyRunning}
              className="h-4 w-4 rounded border-input accent-primary"
            />
            <label
              className="text-sm text-muted-foreground"
              htmlFor="forceRefresh"
            >
              Force refresh (bypass 24h cache)
            </label>
          </div>
        </div>
        <div className="flex gap-3 border-t px-6 py-4">
          <button
            type="button"
            onClick={runAnalysis}
            disabled={isAnyRunning || !websiteUrl.trim()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isRunning ? `Analyzing (${phase})...` : 'Run Full Analysis'}
          </button>
          <button
            type="button"
            onClick={runDebugContent}
            disabled={isAnyRunning || !websiteUrl.trim()}
            className="inline-flex items-center gap-2 rounded-lg border border-input bg-background px-5 py-2.5 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          >
            {isDebugRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            {isDebugRunning ? 'Running debug...' : 'Debug Content'}
          </button>
        </div>
      </div>

      {/* Phase Indicator */}
      {isRunning && <PhaseIndicator phase={phase} />}

      {/* Error */}
      {error !== null && (
        <div className="mb-8 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">
              Analysis Failed
            </p>
            <p className="mt-1 text-sm text-destructive/80">{error}</p>
          </div>
        </div>
      )}

      {/* Analysis result */}
      {result && <AnalysisResult data={result} />}

      {/* Debug error */}
      {debugError !== null && (
        <div className="mb-8 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-medium text-destructive">
              Debug Content Failed
            </p>
            <p className="mt-1 text-sm text-destructive/80">{debugError}</p>
          </div>
        </div>
      )}

      {/* Debug result */}
      {debugResult !== null && (
        <CollapsibleSection
          title="Debug Content Result"
          subtitle={debugJobId ? `Job: ${debugJobId}` : undefined}
          defaultOpen
        >
          <pre className="max-h-[600px] overflow-auto rounded-lg bg-muted/50 p-4 text-xs leading-relaxed">
            {JSON.stringify(debugResult, null, 2)}
          </pre>
        </CollapsibleSection>
      )}
    </div>
  );
}

// ─── Input Field ──────────────────────────────────────────────────────────────

function InputField({
  id,
  label,
  placeholder,
  value,
  onChange,
  disabled,
  optional,
  icon,
}: {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  optional?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
        {optional && (
          <span className="ml-1.5 text-xs font-normal text-muted-foreground">
            Optional
          </span>
        )}
      </label>
      <div className="relative">
        {icon && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
            {icon}
          </div>
        )}
        <input
          id={id}
          className={`flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 ${icon ? 'pl-9' : ''}`}
          type="url"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
        />
      </div>
    </div>
  );
}

// ─── Phase Indicator ──────────────────────────────────────────────────────────

function PhaseIndicator({ phase }: { phase: Phase }) {
  const phases: { key: Phase; label: string; icon: React.ReactNode }[] = [
    {
      key: 'fetching',
      label: 'Fetching website',
      icon: <Globe className="h-4 w-4" />,
    },
    {
      key: 'discovering',
      label: 'Discovering subpages',
      icon: <Search className="h-4 w-4" />,
    },
    {
      key: 'analyzing',
      label: 'AI analysis',
      icon: <Sparkles className="h-4 w-4" />,
    },
  ];

  return (
    <div className="mb-8 rounded-xl border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <p className="text-sm font-medium">Analysis in progress...</p>
      </div>
      <div className="flex gap-4">
        {phases.map((p) => {
          const phaseOrder = phases.findIndex((x) => x.key === phase);
          const thisOrder = phases.findIndex((x) => x.key === p.key);
          const isDone = phaseOrder > thisOrder;
          const isCurrent = phase === p.key;
          return (
            <div
              key={p.key}
              className={`flex flex-1 items-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                isDone
                  ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950 dark:text-green-400'
                  : isCurrent
                    ? 'border-primary/30 bg-primary/5 text-primary'
                    : 'border-transparent bg-muted/30 text-muted-foreground'
              }`}
            >
              {isDone ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" />
              ) : isCurrent ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
              ) : (
                <span className="shrink-0">{p.icon}</span>
              )}
              <span className={isCurrent ? 'font-medium' : ''}>{p.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Collapsible Section ──────────────────────────────────────────────────────

function CollapsibleSection({
  title,
  subtitle,
  icon,
  badge,
  children,
  defaultOpen = false,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-4 rounded-xl border bg-card shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-muted/30"
      >
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">{title}</h3>
            {badge && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {badge}
              </span>
            )}
          </div>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="border-t px-5 py-4">{children}</div>}
    </div>
  );
}

// ─── Analysis Result ──────────────────────────────────────────────────────────

function AnalysisResult({ data }: { data: AnalyzeWebsiteResponse }) {
  return (
    <div className="space-y-4">
      <div className="mb-6 flex items-center gap-2">
        <CheckCircle2 className="h-5 w-5 text-green-600" />
        <h2 className="text-lg font-semibold">Analysis Complete</h2>
      </div>

      {/* Services */}
      <CollapsibleSection
        title="Services"
        icon={<Tag className="h-4 w-4" />}
        badge={`${data.services?.length ?? 0}`}
        defaultOpen
      >
        {data.services?.length ? (
          <div className="overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2.5 text-left font-medium">Service</th>
                  <th className="px-4 py-2.5 text-left font-medium">Pricing</th>
                </tr>
              </thead>
              <tbody>
                {data.services.map((s, i) => (
                  <tr
                    key={i}
                    className="border-b last:border-0 transition-colors hover:bg-muted/20"
                  >
                    <td className="px-4 py-2.5 font-medium">{s.name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {s.pricingDescription || (
                        <span className="italic text-muted-foreground/50">
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No services found</p>
        )}
      </CollapsibleSection>

      {/* Locations */}
      <CollapsibleSection
        title="Locations"
        icon={<MapPin className="h-4 w-4" />}
        badge={`${data.locations?.length ?? 0}`}
        defaultOpen
      >
        {data.locations?.length ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {data.locations.map((loc, i) => (
              <div key={i} className="rounded-lg border bg-background p-4">
                {loc.name && (
                  <p className="mb-1 text-sm font-semibold">{loc.name}</p>
                )}
                <p className="text-sm">{loc.addressLine1}</p>
                <p className="text-sm text-muted-foreground">
                  {[loc.city, loc.county, loc.postalCode]
                    .filter(Boolean)
                    .join(', ')}
                  {loc.country && (
                    <span className="ml-1 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase">
                      {loc.country}
                    </span>
                  )}
                </p>
                {loc.latitude != null && loc.longitude != null && (
                  <p className="mt-1 font-mono text-[11px] text-muted-foreground/60">
                    {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                  </p>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No locations found</p>
        )}
      </CollapsibleSection>

      {/* Business Hours */}
      <CollapsibleSection
        title="Business Hours"
        icon={<Clock className="h-4 w-4" />}
        badge={
          data.businessHours
            ? `${Object.keys(data.businessHours).length} days`
            : undefined
        }
        defaultOpen
      >
        {data.businessHours && Object.keys(data.businessHours).length > 0 ? (
          <div className="space-y-1">
            {DAY_NAMES.map((dayName, dayIdx) => {
              const hours = data.businessHours?.[String(dayIdx)];
              return (
                <div
                  key={dayIdx}
                  className={`flex items-center rounded-md px-3 py-2 text-sm ${
                    hours
                      ? 'bg-background'
                      : 'bg-muted/20 text-muted-foreground'
                  }`}
                >
                  <span className="w-28 font-medium">{dayName}</span>
                  {hours ? (
                    <span className="font-mono text-xs">
                      {fmtTime(hours.from)} – {fmtTime(hours.to)}
                    </span>
                  ) : (
                    <span className="text-xs italic">Closed</span>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No business hours found
          </p>
        )}
      </CollapsibleSection>

      {/* Practitioners */}
      <CollapsibleSection
        title="Practitioners"
        icon={<Users className="h-4 w-4" />}
        badge={`${data.practitioners?.length ?? 0}`}
        defaultOpen
      >
        {data.practitioners?.length ? (
          <div className="flex flex-wrap gap-2">
            {data.practitioners.map((p, i) => (
              <div
                key={i}
                className="inline-flex items-center gap-2 rounded-full border bg-background px-3 py-1.5"
              >
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                  {p.name.charAt(0)}
                </div>
                <span className="text-sm">{p.name}</span>
                {p.title && (
                  <span className="text-xs text-muted-foreground">
                    {p.title}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No practitioners found
          </p>
        )}
      </CollapsibleSection>

      {/* Brand & Visual Identity */}
      <CollapsibleSection
        title="Brand & Visual Identity"
        icon={<Palette className="h-4 w-4" />}
        defaultOpen
      >
        <div className="grid gap-6 sm:grid-cols-2">
          {/* Brand Voice */}
          {data.brandVoice?.length ? (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Brand Voice
              </p>
              <div className="flex flex-wrap gap-1.5">
                {data.brandVoice.map((v, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
                  >
                    {v}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {/* Colors */}
          {(data.primaryColor || data.secondaryColor) && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Brand Colors
              </p>
              <div className="flex gap-3">
                {data.primaryColor && (
                  <ColorSwatch color={data.primaryColor} label="Primary" />
                )}
                {data.secondaryColor && (
                  <ColorSwatch color={data.secondaryColor} label="Secondary" />
                )}
              </div>
            </div>
          )}

          {/* Logo */}
          {data.logoUrl && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Logo
              </p>
              <div className="inline-flex rounded-lg border bg-background p-3">
                <img
                  src={data.logoUrl}
                  alt="Extracted logo"
                  className="max-h-14 object-contain"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </CollapsibleSection>

      {/* Target Audience */}
      {data.targetAudienceDescription && (
        <CollapsibleSection
          title="Target Audience"
          icon={<Building2 className="h-4 w-4" />}
          defaultOpen
        >
          <p className="text-sm leading-relaxed">
            {data.targetAudienceDescription}
          </p>
        </CollapsibleSection>
      )}

      {/* Credibility Lines */}
      {data.suggestedCredibilityLines?.length ? (
        <CollapsibleSection
          title="Suggested Credibility Lines"
          icon={<Quote className="h-4 w-4" />}
          badge={`${data.suggestedCredibilityLines.length}`}
          defaultOpen
        >
          <div className="space-y-2">
            {data.suggestedCredibilityLines.map((line, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg bg-muted/30 px-3 py-2"
              >
                <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <p className="text-sm">{line}</p>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      ) : null}

      {/* Raw JSON */}
      <CollapsibleSection title="Raw JSON" defaultOpen={false}>
        <pre className="max-h-[500px] overflow-auto rounded-lg bg-muted/50 p-4 text-xs leading-relaxed">
          {JSON.stringify(data, null, 2)}
        </pre>
      </CollapsibleSection>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function ColorSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="h-8 w-8 rounded-lg border shadow-sm"
        style={{ backgroundColor: color }}
      />
      <div>
        <p className="text-xs font-medium">{label}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{color}</p>
      </div>
    </div>
  );
}

function fmtTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
