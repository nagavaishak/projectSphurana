'use client';

/**
 * The Clinical tab — notes for this encounter, and the treatment plan a
 * patient receives.
 *
 * ## Why this replaced two tabs
 *
 * An earlier draft had "Clinical" (a hardcoded drug record + a hardcoded
 * aftercare table) and "Notes" (a free-text thread with a delete button). Both
 * were wrong, and in the same way: the NOTE is the container, and the drug
 * record is a structured FIELD inside it. Aftercare is a template field too —
 * a laser clinic and an injectables clinic record different things.
 *
 * ## Three rules this screen enforces (portal.md §2.9)
 *
 * 1. A signed note is IMMUTABLE. Correct it with a dated addendum; the
 *    original stays visible. There is no delete, because deleting destroys the
 *    only thing the record is for.
 * 2. A note is NEVER shown to the patient. What they get is a treatment plan,
 *    generated from the note and edited before it is sent.
 * 3. Medications write a traceable row against the lot, not just a note field.
 *    On a recall the clinic must produce every patient who had lot AZ4471-B.
 */

import {
  CheckCircle2Icon,
  FileTextIcon,
  MicIcon,
  MinimizeIcon,
  MoreHorizontalIcon,
  PencilLineIcon,
  PlusIcon,
  SendIcon,
  SparklesIcon,
  SquareIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

import {
  MEDICATIONS,
  formatEuro,
  medicationLabel,
} from './appointment-view-medications';
import {
  ALL_TEMPLATES,
  type Administered,
  FREEFORM_TEMPLATE,
  NOTE_TEMPLATES,
  type Note,
  type NoteField,
  type NoteTemplate,
  PLAN_TEMPLATE_BODY,
  SCRIBE_SAMPLE,
  type ScribeConsent,
  TRANSCRIPT_LINES,
  initialNotes,
} from './appointment-view-notes-model';
import { NeedsTable, Panel } from './appointment-view-panels';

const ME = 'Demo Owner';

type Revision = {
  id: string;
  label: string;
  values: Record<string, string | string[]>;
};

/**
 * Stands in for sending the note plus the instruction to the model. It routes
 * the request to a field by name where it can, and falls back to the last
 * prose field — which is roughly what a real one does, minus the language.
 *
 * It deliberately never touches the medications field, for the same reason
 * generation does not: a lot number is not a thing to be edited by sentence.
 */
function applyInstruction(
  values: Record<string, string | string[]>,
  template: NoteTemplate,
  ask: string
): Record<string, string | string[]> {
  const prose = template.fields.filter(
    (f) => f.type === 'long_text' || f.type === 'short_text'
  );
  const lower = ask.toLowerCase();
  const target =
    prose.find((f) => lower.includes(f.label.toLowerCase())) ??
    prose[prose.length - 1];
  if (!target) return values;

  const current = (values[target.id] as string) ?? '';
  return { ...values, [target.id]: `${current} ${ask}`.trim() };
}

const now = () =>
  new Date().toLocaleString('en-IE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

export function ClinicalPanel({
  patient,
  start,
  consent = 'not_set',
}: {
  patient: string;
  /** Fixture dates hang off the real appointment — see `initialNotes`. */
  start: Date;
  consent?: ScribeConsent;
}) {
  const [notes, setNotes] = useState<Note[]>(() => initialNotes(start));
  const [composing, setComposing] = useState<NoteTemplate | null>(null);
  const [planFor, setPlanFor] = useState<Note | null>(null);
  const [reading, setReading] = useState<Note | null>(null);
  /**
   * Recording lives HERE, not in the dialog, so closing the dialog does not
   * stop it. That is the whole point of the mini-player.
   */
  const [recording, setRecording] = useState(false);
  const [minimised, setMinimised] = useState(false);
  const [transcript, setTranscript] = useState<string[]>([]);

  // Stands in for live transcription: a line lands every second or so.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      setTranscript((prev) =>
        prev.length >= TRANSCRIPT_LINES.length
          ? prev
          : [...prev, TRANSCRIPT_LINES[prev.length]]
      );
    }, 900);
    return () => clearInterval(t);
  }, [recording]);

  const startNote = (tpl: NoteTemplate) => {
    setComposing(tpl);
    setMinimised(false);
  };

  const saveNote = (note: Note) => {
    setNotes((n) => [note, ...n]);
    setComposing(null);
    setRecording(false);
    setTranscript([]);
    toast.success(note.status === 'signed' ? 'Note signed' : 'Draft saved');
  };

  const addAddendum = (noteId: string, body: string) => {
    setNotes((all) =>
      all.map((n) =>
        n.id === noteId
          ? {
              ...n,
              addenda: [
                ...n.addenda,
                { id: `a${Date.now()}`, author: ME, at: now(), body },
              ],
            }
          : n
      )
    );
    toast.success('Addendum added');
  };

  return (
    <div className="space-y-8">
      <Panel
        title="Notes"
        description="Every note on this appointment, newest first. Open one to read it in full."
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm">
                <PlusIcon className="size-3.5" />
                New note
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {NOTE_TEMPLATES.map((t) => (
                <DropdownMenuItem key={t.id} onSelect={() => startNote(t)}>
                  <FileTextIcon className="size-4" />
                  {t.name}
                </DropdownMenuItem>
              ))}
              {/* Freeform sits in the SAME menu and the same list. A phone
                  call about a bruise is a real clinical event that fits no
                  consultation form, and it should not need a second tab. */}
              <DropdownMenuItem onSelect={() => startNote(FREEFORM_TEMPLATE)}>
                <PencilLineIcon className="size-4" />
                Freeform note
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {notes.length === 0 ? (
          <div className="flex min-h-[160px] items-center justify-center rounded-xl border border-dashed">
            <p className="text-muted-foreground text-sm">
              Nothing recorded for this appointment yet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {notes.map((n) => (
              <NotePreview key={n.id} note={n} onOpen={() => setReading(n)} />
            ))}
          </div>
        )}
      </Panel>

      {composing && !minimised ? (
        <NewNoteDialog
          template={composing}
          patient={patient}
          consent={consent}
          recording={recording}
          transcript={transcript}
          onStartRecording={() => setRecording(true)}
          onStopRecording={() => setRecording(false)}
          onMinimise={() => setMinimised(true)}
          onCancel={() => {
            setComposing(null);
            setRecording(false);
            setTranscript([]);
          }}
          onSave={saveNote}
        />
      ) : null}

      {recording && minimised ? (
        <MiniPlayer
          lines={transcript.length}
          onStop={() => setRecording(false)}
          onReturn={() => setMinimised(false)}
        />
      ) : null}

      {reading ? (
        <NoteReader
          note={notes.find((n) => n.id === reading.id) ?? reading}
          patient={patient}
          onClose={() => setReading(null)}
          onAddendum={(body) => addAddendum(reading.id, body)}
          onGeneratePlan={() => {
            const n = reading;
            setReading(null);
            setPlanFor(n);
          }}
        />
      ) : null}

      {planFor ? (
        <TreatmentPlanDialog
          note={planFor}
          patient={patient}
          appointmentDate={start.toLocaleDateString('en-IE', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
          onClose={() => setPlanFor(null)}
        />
      ) : null}

      <NeedsTable>
        <strong className="font-medium text-foreground">
          Templates and notes have tables; the treatment record does not yet.
        </strong>{' '}
        A note is <code>form_submission</code> with <code>kind = 'note'</code>,
        and the plan is <code>treatment_plan</code> — both landed. What is still
        missing is the row a medications field must ALSO write: administering a
        dose has to be queryable by lot, and a jsonb answers blob cannot answer
        “who received AZ4471-B” on a recall.
      </NeedsTable>
    </div>
  );
}

/* --------------------------------------------------------- the note feed -- */

/** Everything the note says, flattened, for the preview line. */
function summarise(note: Note): string {
  const tpl = ALL_TEMPLATES.find((t) => t.id === note.templateId);
  const parts: string[] = [];
  for (const f of tpl?.fields ?? []) {
    if (f.type === 'signature' || f.type === 'medications') continue;
    const v = note.values[f.id];
    const text = Array.isArray(v) ? v.join(', ') : v;
    if (!text) continue;
    // Freeform has one unnamed field; a structured note reads better labelled.
    parts.push(tpl?.id === FREEFORM_TEMPLATE.id ? text : `${f.label}: ${text}`);
  }
  return parts.join(' · ');
}

/**
 * One row in the feed. Deliberately SHORT: notes accumulate over a patient's
 * life, and a tab that renders every field of every note in full is a tab
 * nobody scrolls. The card answers "what kind of note, by whom, when, roughly
 * about what" and the reader answers everything else.
 */
function NotePreview({ note, onOpen }: { note: Note; onOpen: () => void }) {
  const tpl = ALL_TEMPLATES.find((t) => t.id === note.templateId);
  const med = MEDICATIONS.find((m) => m.id === note.meds[0]?.medicationId);
  const dose = note.meds.reduce((n, m) => n + m.dose, 0);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border bg-background px-5 py-4 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="font-medium">{tpl?.name ?? 'Note'}</p>
        <p className="text-muted-foreground text-xs">{note.at}</p>
      </div>
      <p className="mt-0.5 text-muted-foreground text-sm">{note.author}</p>

      {/* line-clamp gives the "…" the browser draws itself, so it truncates
          at the RENDERED width rather than a guessed character count. */}
      <p className="mt-2 line-clamp-2 text-sm leading-relaxed">
        {summarise(note)}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant={note.status === 'signed' ? 'secondary' : 'outline'}>
          {note.status === 'signed' ? 'Signed' : 'Draft'}
        </Badge>
        {med ? (
          <Badge variant="outline" className="font-normal">
            {med.brand ?? med.name} · {dose} {med.unit.toLowerCase()} ·{' '}
            <span className="font-mono">{note.meds[0]?.lot}</span>
          </Badge>
        ) : null}
        {note.addenda.length > 0 ? (
          <Badge variant="outline" className="font-normal">
            {note.addenda.length} addendum
          </Badge>
        ) : null}
      </div>
    </button>
  );
}

/* ------------------------------------------------------------ the reader -- */

/**
 * The note as a DOCUMENT. This is what gets printed, exported and handed to a
 * solicitor, so it is laid out as a page — letterhead, patient, the fields in
 * template order, the signature block, then addenda — rather than as an
 * editing form. Reading and writing a clinical note are different jobs.
 */
function NoteReader({
  note,
  patient,
  onClose,
  onAddendum,
  onGeneratePlan,
}: {
  note: Note;
  patient: string;
  onClose: () => void;
  onAddendum: (body: string) => void;
  onGeneratePlan: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const tpl = ALL_TEMPLATES.find((t) => t.id === note.templateId);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-5 py-3">
          <DialogTitle className="text-base">{tpl?.name ?? 'Note'}</DialogTitle>
          <div className="flex items-center gap-2">
            <Badge variant={note.status === 'signed' ? 'secondary' : 'outline'}>
              {note.status === 'signed' ? 'Signed' : 'Draft'}
            </Badge>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" aria-label="Note actions">
                  <MoreHorizontalIcon className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              {/* No delete, at any depth. A signed note is corrected. */}
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={onGeneratePlan}>
                  <SendIcon className="size-4" />
                  Generate treatment plan
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAdding(true)}>
                  <PlusIcon className="size-4" />
                  Add addendum
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </DialogHeader>

        <div className="overflow-y-auto px-8 py-7">
          {/* Letterhead. A clinical record is read out of context — months
              later, by someone else — so the page names itself. */}
          <div className="border-b pb-5">
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-widest">
              Lumière — Grafton Street
            </p>
            <h2 className="mt-1 font-semibold text-xl">{patient}</h2>
            <p className="mt-0.5 text-muted-foreground text-sm">
              {tpl?.name} · {note.author} · {note.at}
            </p>
          </div>

          <dl className="divide-y">
            {tpl?.fields.map((f) => (
              <ReadField key={f.id} field={f} note={note} />
            ))}
          </dl>

          {note.addenda.length > 0 ? (
            <div className="mt-6 border-t pt-5">
              <p className="font-medium text-muted-foreground text-xs uppercase tracking-widest">
                Addenda
              </p>
              <div className="mt-3 space-y-4">
                {note.addenda.map((a) => (
                  <div key={a.id} className="border-l-2 pl-4">
                    <p className="text-muted-foreground text-xs">
                      {a.author} · {a.at}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed">{a.body}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {adding ? (
            <div className="mt-6 space-y-2 border-t pt-5">
              <Label htmlFor={`add-${note.id}`}>Addendum</Label>
              <p className="text-muted-foreground text-xs">
                The note above does not change. This is added beneath it, dated.
              </p>
              <Textarea
                id={`add-${note.id}`}
                rows={3}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="What changed, and when you learned it…"
              />
              <div className="flex justify-end gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAdding(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!draft.trim()}
                  onClick={() => {
                    onAddendum(draft.trim());
                    setDraft('');
                    setAdding(false);
                  }}
                >
                  Add addendum
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReadField({ field, note }: { field: NoteField; note: Note }) {
  if (field.type === 'signature') {
    return (
      <div className="flex items-center gap-2 px-5 py-3.5 text-sm">
        <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" />
        <span className="text-muted-foreground">
          Signed by {note.author} · {note.at}
        </span>
      </div>
    );
  }

  if (field.type === 'medications') {
    if (note.meds.length === 0) return null;
    return (
      <div className="px-5 py-3.5">
        <dt className="text-muted-foreground text-sm">{field.label}</dt>
        <dd className="mt-2">
          <MedicationTable meds={note.meds} />
        </dd>
      </div>
    );
  }

  const value = note.values[field.id];
  const text = Array.isArray(value) ? value.join(', ') : value;
  if (!text) return null;

  return (
    <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 px-5 py-3.5">
      <dt className="w-36 shrink-0 text-muted-foreground text-sm">
        {field.label}
      </dt>
      <dd className="min-w-0 flex-1 text-sm leading-relaxed">{text}</dd>
    </div>
  );
}

function MedicationTable({ meds }: { meds: Administered[] }) {
  const med = MEDICATIONS.find((m) => m.id === meds[0]?.medicationId);
  const total = meds.reduce((n, m) => n + m.dose, 0);

  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-4 py-2.5">
        <div className="min-w-0">
          <p className="font-medium text-sm">{med?.name}</p>
          <p className="text-muted-foreground text-xs">
            {med?.brand ? `${med.brand} · ` : ''}
            {total} {med?.unit.toLowerCase()} ·{' '}
            {formatEuro(total * (med?.pricePerUnitCents ?? 0))}
          </p>
        </div>
        {/* Batch carries the weight of a value: it IS the traceability record. */}
        <div className="text-right">
          <p className="text-muted-foreground text-xs">Batch</p>
          <p className="font-mono text-sm tabular-nums">{meds[0]?.lot}</p>
        </div>
      </div>
      <table className="w-full text-sm">
        <tbody className="divide-y">
          {meds.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-2">{m.area}</td>
              <td className="px-4 py-2 text-right tabular-nums">
                {m.dose} {med?.unit.toLowerCase()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------- new note dialog -- */

/**
 * New note, including the AI one. The scribe is a NOTE, not an appointment
 * action: you pick a template, record, and the model fills that template's
 * questions. What makes that workable while you move around the app is the
 * MINI-PLAYER — recording continues when the dialog closes.
 *
 * Consent is a property of the PATIENT, not the visit: three states on the
 * chart, answerable by the patient through an intake question. Opted out means
 * the recorder is not offered at all — a disabled button invites someone to
 * look for a way round it.
 */
function NewNoteDialog({
  template,
  patient,
  consent,
  recording,
  transcript,
  onStartRecording,
  onStopRecording,
  onMinimise,
  onCancel,
  onSave,
}: {
  template: NoteTemplate;
  patient: string;
  consent: ScribeConsent;
  recording: boolean;
  transcript: string[];
  onStartRecording: () => void;
  onStopRecording: () => void;
  onMinimise: () => void;
  onCancel: () => void;
  onSave: (note: Note) => void;
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [meds, setMeds] = useState<Administered[]>([]);
  const [aiFields, setAiFields] = useState<Set<string>>(new Set());
  const [generated, setGenerated] = useState(false);
  /**
   * Every refinement is a NEW REVISION, never an overwrite. A clinician who
   * asks for a change and dislikes the result must be able to get the previous
   * wording back — otherwise "ask AI to tidy this up" is a one-way risk on a
   * document they are about to put their name to.
   */
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [instruction, setInstruction] = useState('');

  const canScribe = consent !== 'opted_out';

  const generate = () => {
    const drafted: Record<string, string | string[]> = {};
    for (const f of template.fields) {
      if (f.type === 'signature' || f.type === 'medications') continue;
      const sample = SCRIBE_SAMPLE[f.id];
      if (sample) drafted[f.id] = sample;
    }
    setValues((prev) => ({ ...prev, ...drafted }));
    setAiFields(new Set(Object.keys(drafted)));
    setGenerated(true);
    setRevisions([
      { id: 'v1', label: 'Generated from the consultation', values: drafted },
    ]);
    onStopRecording();
    toast.success('Note generated — review every field before signing');
  };

  const refine = () => {
    const ask = instruction.trim();
    if (!ask) return;
    const next = applyInstruction(values, template, ask);
    setValues(next);
    setRevisions((r) => [
      ...r,
      { id: `v${r.length + 1}`, label: ask, values: next },
    ]);
    // The model touched them, so they are unreviewed again.
    setAiFields(new Set(Object.keys(next)));
    setInstruction('');
    toast.success('New revision created');
  };

  const restore = (rev: Revision) => {
    setValues(rev.values);
    setAiFields(new Set(Object.keys(rev.values)));
    toast.success(`Restored “${rev.label}”`);
  };

  const build = (status: Note['status']): Note => ({
    id: `n${Date.now()}`,
    templateId: template.id,
    author: ME,
    at: now(),
    status,
    values,
    meds,
    addenda: [],
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b px-5 py-3">
          <DialogTitle className="text-base">
            New note — {template.name}
          </DialogTitle>
          {recording ? (
            <Button size="sm" variant="ghost" onClick={onMinimise}>
              <MinimizeIcon className="size-3.5" />
              Keep recording, close
            </Button>
          ) : null}
        </DialogHeader>

        <div className="overflow-y-auto">
          {/* ---- the recorder ---- */}
          {!generated ? (
            <div className="border-b px-5 py-4">
              {canScribe ? (
                <Recorder
                  recording={recording}
                  transcript={transcript}
                  onStart={onStartRecording}
                  onStop={onStopRecording}
                  onGenerate={generate}
                />
              ) : (
                <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm">
                  <strong className="font-medium">
                    {patient} has opted out of AI Scribe.
                  </strong>{' '}
                  Write the note by hand below. Their preference is on the
                  client record and can be changed there or by their answer to
                  an intake question.
                </p>
              )}
            </div>
          ) : null}

          {generated && aiFields.size > 0 ? (
            <div className="border-b bg-accent/40 px-5 py-3">
              <p className="text-sm">
                <strong className="font-medium">
                  {aiFields.size} fields filled from the consultation.
                </strong>{' '}
                Read each before signing — your signature is your attestation,
                not the model's.
              </p>
              <p className="mt-1 text-muted-foreground text-xs">
                Batch numbers are never filled from speech. A lot is per-vial,
                exists in no catalogue, and is chosen or scanned by you.
              </p>
            </div>
          ) : null}

          <div className="divide-y">
            {template.fields.map((f) => (
              <EditField
                key={f.id}
                field={f}
                value={values[f.id]}
                meds={meds}
                onMeds={setMeds}
                aiDrafted={aiFields.has(f.id)}
                onChange={(v) => {
                  setValues((p) => ({ ...p, [f.id]: v }));
                  setAiFields((prev) => {
                    if (!prev.has(f.id)) return prev;
                    const next = new Set(prev);
                    next.delete(f.id);
                    return next;
                  });
                }}
              />
            ))}
          </div>
        </div>

        {generated ? (
          <div className="space-y-3 border-t px-5 py-4">
            {revisions.length > 1 ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-muted-foreground text-xs">
                  {revisions.length} versions
                </span>
                {revisions.map((r, i) => (
                  <Button
                    key={r.id}
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() => restore(r)}
                    title={r.label}
                  >
                    v{i + 1}
                  </Button>
                ))}
              </div>
            ) : null}

            <div className="flex gap-2">
              <Input
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') refine();
                }}
                placeholder="Ask for a change — “expand the assessment”, “add that she is on aspirin”…"
              />
              <Button
                variant="outline"
                onClick={refine}
                disabled={!instruction.trim()}
              >
                <SparklesIcon className="size-3.5" />
                Refine
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Each request creates a new version — the previous wording stays
              recoverable above.
            </p>
          </div>
        ) : null}

        <DialogFooter className="border-t bg-muted/30 px-5 py-4">
          <Button variant="ghost" onClick={onCancel}>
            Discard
          </Button>
          <Button variant="outline" onClick={() => onSave(build('draft'))}>
            Save draft
          </Button>
          {/* Signing is the one-way door — after this it is addenda only. */}
          <Button onClick={() => onSave(build('signed'))}>Sign note</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Recorder({
  recording,
  transcript,
  onStart,
  onStop,
  onGenerate,
}: {
  recording: boolean;
  transcript: string[];
  onStart: () => void;
  onStop: () => void;
  onGenerate: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {recording ? (
          <Button size="sm" variant="outline" onClick={onStop}>
            <SquareIcon className="size-3.5" />
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={onStart}>
            <MicIcon className="size-3.5" />
            Record consultation
          </Button>
        )}

        {recording ? (
          <span className="flex items-center gap-2 text-muted-foreground text-sm">
            <span className="size-2 animate-pulse rounded-full bg-red-500" />
            Recording · {transcript.length} lines
          </span>
        ) : null}

        <div className="ml-auto">
          <Button
            size="sm"
            disabled={transcript.length === 0}
            onClick={onGenerate}
          >
            <SparklesIcon className="size-3.5" />
            Generate note
          </Button>
        </div>
      </div>

      {transcript.length > 0 ? (
        <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/30 px-4 py-3">
          {transcript.map((line) => (
            <p
              key={line}
              className="text-muted-foreground text-sm leading-relaxed"
            >
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The mini-player. Its whole reason to exist is that a consultation does not
 * pause while the clinician looks something up — closing the note must not
 * stop the recording, and there must be an obvious way back to it.
 */
function MiniPlayer({
  lines,
  onStop,
  onReturn,
}: {
  lines: number;
  onStop: () => void;
  onReturn: () => void;
}) {
  return (
    <div className="fixed right-6 bottom-6 z-50 flex items-center gap-3 rounded-full border bg-background py-2 pr-2 pl-4 shadow-lg">
      <span className="size-2 animate-pulse rounded-full bg-red-500" />
      <span className="text-sm tabular-nums">Recording · {lines} lines</span>
      <Button size="sm" variant="ghost" onClick={onReturn}>
        Go to note
      </Button>
      <Button size="sm" variant="outline" onClick={onStop}>
        <SquareIcon className="size-3.5" />
        Stop
      </Button>
    </div>
  );
}

function EditField({
  field,
  value,
  meds,
  onMeds,
  onChange,
  aiDrafted,
}: {
  field: NoteField;
  value: string | string[] | undefined;
  meds: Administered[];
  onMeds: (m: Administered[]) => void;
  onChange: (v: string | string[]) => void;
  aiDrafted?: boolean;
}) {
  return (
    <div
      className={cn(
        'space-y-2 px-5 py-4',
        aiDrafted && 'border-l-2 border-l-primary/60 bg-accent/20'
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={`f-${field.id}`}>{field.label}</Label>
        {aiDrafted ? (
          <Badge variant="outline" className="gap-1 text-xs">
            <SparklesIcon className="size-3" />
            AI draft — unreviewed
          </Badge>
        ) : null}
      </div>
      {field.help ? (
        <p className="text-muted-foreground text-xs">{field.help}</p>
      ) : null}

      {field.type === 'long_text' ? (
        <Textarea
          id={`f-${field.id}`}
          rows={3}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : null}

      {field.type === 'short_text' || field.type === 'date' ? (
        <Input
          id={`f-${field.id}`}
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.type === 'date' ? 'e.g. 16 March 2026' : undefined}
        />
      ) : null}

      {field.type === 'single_select' ? (
        <Select value={(value as string) ?? ''} onValueChange={onChange}>
          <SelectTrigger id={`f-${field.id}`} className="w-full">
            <SelectValue placeholder="Choose…" />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {field.type === 'multi_select' ? (
        <div className="flex flex-wrap gap-1.5">
          {field.options?.map((o) => {
            const on = Array.isArray(value) && value.includes(o);
            return (
              <button
                key={o}
                type="button"
                onClick={() => {
                  const cur = Array.isArray(value) ? value : [];
                  onChange(on ? cur.filter((x) => x !== o) : [...cur, o]);
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  on
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted'
                )}
              >
                {o}
              </button>
            );
          })}
        </div>
      ) : null}

      {field.type === 'medications' ? (
        <MedicationsField meds={meds} onChange={onMeds} />
      ) : null}

      {field.type === 'signature' ? (
        <p className="text-muted-foreground text-sm">
          Applied when you sign the note.
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------- medications field -- */

const SITES = [
  'Glabella',
  'Frontalis',
  'Crow’s feet — left',
  'Crow’s feet — right',
  'Lips',
  'Jawline',
];

function MedicationsField({
  meds,
  onChange,
}: {
  meds: Administered[];
  onChange: (m: Administered[]) => void;
}) {
  const [medId, setMedId] = useState(MEDICATIONS[0].id);
  const [lot, setLot] = useState(MEDICATIONS[0].lots[0].lot);
  const [area, setArea] = useState(SITES[0]);
  const [dose, setDose] = useState('10');

  const med = MEDICATIONS.find((m) => m.id === medId);
  if (!med) return null;

  const add = () => {
    const chosen = med.lots.find((l) => l.lot === lot) ?? med.lots[0];
    onChange([
      ...meds,
      {
        id: `m${Date.now()}`,
        medicationId: medId,
        lot: chosen.lot,
        expiry: chosen.expiry,
        area,
        dose: Number(dose) || 0,
      },
    ]);
  };

  return (
    <div className="space-y-3 rounded-lg border p-3">
      {meds.length > 0 ? <MedicationTable meds={meds} /> : null}

      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="mf-med" className="text-xs">
            Medication
          </Label>
          <Select
            value={medId}
            onValueChange={(id) => {
              setMedId(id);
              const next = MEDICATIONS.find((m) => m.id === id);
              if (next) setLot(next.lots[0].lot);
            }}
          >
            <SelectTrigger id="mf-med" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MEDICATIONS.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {medicationLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          {/* A select, never free text: a mistyped batch number is invisible
              until the day somebody needs it. */}
          <Label htmlFor="mf-lot" className="text-xs">
            Batch
          </Label>
          <Select value={lot} onValueChange={setLot}>
            <SelectTrigger id="mf-lot" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {med.lots.map((l) => (
                <SelectItem key={l.lot} value={l.lot}>
                  {l.lot} · exp. {l.expiry} · {l.quantity} left
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mf-site" className="text-xs">
            Site
          </Label>
          <Select value={area} onValueChange={setArea}>
            <SelectTrigger id="mf-site" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SITES.map((sName) => (
                <SelectItem key={sName} value={sName}>
                  {sName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="mf-dose" className="text-xs">
            Dose ({med.unit.toLowerCase()})
          </Label>
          <div className="flex gap-2">
            <Input
              id="mf-dose"
              inputMode="numeric"
              value={dose}
              onChange={(e) => setDose(e.target.value)}
            />
            <Button type="button" variant="outline" onClick={add}>
              Add
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------- treatment plan -- */

/**
 * Generated FROM the note, edited, then sent. The patient never reads the note
 * itself — enforced in the database by `form_note_never_patient_visible`.
 */
function TreatmentPlanDialog({
  note,
  patient,
  appointmentDate,
  onClose,
}: {
  note: Note;
  patient: string;
  appointmentDate: string;
  onClose: () => void;
}) {
  const resolve = (body: string) =>
    body
      .replace('{{patient_first_name}}', patient.split(' ')[0] ?? 'there')
      .replace('{{appointment_date}}', appointmentDate)
      .replace(
        '{{areas}}',
        Array.isArray(note.values.areas)
          ? note.values.areas.map((a) => `· ${a}`).join('\n')
          : '·'
      )
      .replace('{{after}}', (note.values.after as string) ?? '')
      .replace('{{review}}', (note.values.review as string) ?? '')
      .replace('{{clinic_phone}}', '01 555 0134')
      .replace('{{clinician_name}}', note.author)
      .replace('{{clinic_name}}', 'Lumière — Grafton Street');

  const [body, setBody] = useState(() => resolve(PLAN_TEMPLATE_BODY));
  const [deliveries, setDeliveries] = useState<string[]>([]);

  const send = (how: 'email' | 'portal') => {
    setDeliveries((d) => [
      `${how === 'email' ? 'Emailed' : 'Published to portal'} · ${now()}`,
      ...d,
    ]);
    toast.success(
      how === 'email' ? 'Plan emailed as a PDF' : 'Plan published to the portal'
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Treatment plan for {patient}</DialogTitle>
        </DialogHeader>

        <p className="text-muted-foreground text-sm">
          Generated from the note and pre-filled. Edit the wording — the patient
          reads this, never the note.
        </p>

        <Textarea
          rows={14}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          className="font-sans text-sm leading-relaxed"
        />

        {deliveries.length > 0 ? (
          <div className="rounded-lg border bg-muted/30 px-4 py-3">
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              Delivery history
            </p>
            <ul className="mt-1.5 space-y-1">
              {deliveries.map((d) => (
                <li key={d} className="text-sm">
                  {d}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant="outline" onClick={() => send('portal')}>
            Add to patient portal
          </Button>
          <Button onClick={() => send('email')}>
            <SendIcon className="size-3.5" />
            Send email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
