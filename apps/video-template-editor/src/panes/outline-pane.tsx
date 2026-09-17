import type {
  Slot,
  TemplateDoc,
  TemplateOverlayBlock,
  TemplateRegion,
  TemplateSpineBlock,
} from '@borradh-workspace/video-templates';
import { type CSSProperties, type ReactNode, useState } from 'react';
import { pathKey } from '../lib/node-path';
import { useEditorStore } from '../state';
import type { NodePath } from '../types';

// Minimal local view of the editor state we read from. The real shape is
// owned by W-A in `../state`; this interface only documents the keys we
// consume here so the selector callbacks below are well-typed.
interface OutlineStateSlice {
  doc: TemplateDoc | null;
  selection: NodePath | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const isSlot = (value: unknown): value is Slot<unknown> => {
  if (value === null || typeof value !== 'object') return false;
  const src = (value as { source?: unknown }).source;
  return src === 'fixed' || src === 'query';
};

const blockKindIcon = (kind: string): string => {
  switch (kind) {
    case 'media-track':
      return '▶';
    case 'solid':
      return '▣';
    case 'staggered-list':
      return '⌘';
    default:
      return '•';
  }
};

const slotKindLabel = (slot: Slot<unknown>): string => {
  if (slot.source === 'fixed') return 'fixed';
  return `query · ${slot.query.kind}`;
};

const slotDotColor = (slot: Slot<unknown>): string => {
  if (slot.source === 'fixed') return '#3ecf8e';
  // All queries treated as unresolved at v0 — refine when W-A's synth state lands.
  if (slot.required) return 'var(--error)';
  return 'var(--accent)';
};

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RowProps {
  path: NodePath;
  depth: number;
  icon?: ReactNode;
  label: ReactNode;
  meta?: ReactNode;
  selected: boolean;
  onSelect: (path: NodePath) => void;
  expandable?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
  dot?: string;
}

const Row = ({
  path,
  depth,
  icon,
  label,
  meta,
  selected,
  onSelect,
  expandable,
  expanded,
  onToggleExpand,
  dot,
}: RowProps) => {
  const style: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 8px',
    paddingLeft: 8 + depth * 12,
    cursor: 'pointer',
    background: selected ? 'var(--bg-elev-2)' : 'transparent',
    borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
    userSelect: 'none',
    fontSize: 12,
    lineHeight: '18px',
    color: 'var(--fg)',
  };

  return (
    <div
      role="button"
      tabIndex={0}
      style={style}
      onClick={(e) => {
        e.stopPropagation();
        onSelect(path);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          onSelect(path);
        }
      }}
      data-path={pathKey(path)}
    >
      {expandable ? (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand?.();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onToggleExpand?.();
            }
          }}
          style={{
            display: 'inline-block',
            width: 12,
            color: 'var(--fg-muted)',
            textAlign: 'center',
          }}
        >
          {expanded ? '▾' : '▸'}
        </span>
      ) : (
        <span style={{ display: 'inline-block', width: 12 }} />
      )}
      {dot ? (
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: dot,
            flexShrink: 0,
          }}
        />
      ) : null}
      {icon ? (
        <span
          style={{ width: 14, textAlign: 'center', color: 'var(--fg-muted)' }}
        >
          {icon}
        </span>
      ) : null}
      <span
        style={{
          flex: 1,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
      {meta ? (
        <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{meta}</span>
      ) : null}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Section header (non-selectable label)
// ---------------------------------------------------------------------------

interface SectionProps {
  depth: number;
  label: string;
}

const Section = ({ depth, label }: SectionProps) => (
  <div
    style={{
      padding: '6px 8px',
      paddingLeft: 8 + depth * 12,
      fontSize: 10,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
      color: 'var(--fg-muted)',
      fontWeight: 600,
    }}
  >
    {label}
  </div>
);

// ---------------------------------------------------------------------------
// Slot leaves for a given block
// ---------------------------------------------------------------------------

interface SlotLeaf {
  // Path from the block to the slot itself.
  subpath: ReadonlyArray<string | number>;
  label: string;
}

const slotLeavesForSpineBlock = (block: TemplateSpineBlock): SlotLeaf[] => {
  switch (block.kind) {
    case 'media-track':
      return [{ subpath: ['clips'], label: 'clips' }];
    case 'solid':
      return [{ subpath: ['color'], label: 'color' }];
    default:
      return [];
  }
};

const slotLeavesForOverlayBlock = (block: TemplateOverlayBlock): SlotLeaf[] => {
  switch (block.kind) {
    case 'staggered-list': {
      const leaves: SlotLeaf[] = [];
      if (block.lead)
        leaves.push({ subpath: ['lead', 'text'], label: 'lead.text' });
      leaves.push({ subpath: ['items', 'texts'], label: 'items.texts' });
      if (block.trail)
        leaves.push({ subpath: ['trail', 'text'], label: 'trail.text' });
      return leaves;
    }
    default:
      return [];
  }
};

// ---------------------------------------------------------------------------
// Block (spine or overlay)
// ---------------------------------------------------------------------------

interface BlockProps {
  block: TemplateSpineBlock | TemplateOverlayBlock;
  path: NodePath;
  depth: number;
  selection: NodePath | null;
  expanded: Set<string>;
  toggle: (key: string) => void;
  onSelect: (path: NodePath) => void;
  variant: 'spine' | 'overlay';
}

const isPathEqual = (a: NodePath, b: NodePath | null): boolean => {
  if (!b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const BlockRow = ({
  block,
  path,
  depth,
  selection,
  expanded,
  toggle,
  onSelect,
  variant,
}: BlockProps) => {
  const key = pathKey(path);
  const isExpanded = expanded.has(key);
  const leaves =
    variant === 'spine'
      ? slotLeavesForSpineBlock(block as TemplateSpineBlock)
      : slotLeavesForOverlayBlock(block as TemplateOverlayBlock);

  return (
    <>
      <Row
        path={path}
        depth={depth}
        icon={blockKindIcon(block.kind)}
        label={block.id}
        meta={block.kind}
        selected={isPathEqual(path, selection)}
        onSelect={onSelect}
        expandable={leaves.length > 0}
        expanded={isExpanded}
        onToggleExpand={() => toggle(key)}
      />
      {isExpanded
        ? leaves.map((leaf) => {
            const slotPath: NodePath = [...path, ...leaf.subpath];
            // Walk into the block in-memory to find the slot value.
            let cursor: unknown = block;
            for (const segment of leaf.subpath) {
              if (cursor === null || cursor === undefined) {
                cursor = undefined;
                break;
              }
              cursor = (cursor as Record<string, unknown>)[String(segment)];
            }
            const slot = isSlot(cursor) ? (cursor as Slot<unknown>) : null;
            return (
              <Row
                key={pathKey(slotPath)}
                path={slotPath}
                depth={depth + 1}
                label={leaf.label}
                meta={slot ? slotKindLabel(slot) : '—'}
                dot={slot ? slotDotColor(slot) : 'var(--fg-muted)'}
                selected={isPathEqual(slotPath, selection)}
                onSelect={onSelect}
              />
            );
          })
        : null}
    </>
  );
};

// ---------------------------------------------------------------------------
// Region (leaf or split, recursive)
// ---------------------------------------------------------------------------

interface RegionProps {
  region: TemplateRegion;
  path: NodePath;
  depth: number;
  selection: NodePath | null;
  expanded: Set<string>;
  toggle: (key: string) => void;
  onSelect: (path: NodePath) => void;
}

const RegionRows = ({
  region,
  path,
  depth,
  selection,
  expanded,
  toggle,
  onSelect,
}: RegionProps) => {
  if (region.kind === 'leaf') {
    return (
      <>
        <Row
          path={path}
          depth={depth}
          icon="▢"
          label={region.id}
          meta="leaf"
          selected={isPathEqual(path, selection)}
          onSelect={onSelect}
        />
        {region.spine.length > 0 ? (
          <Section depth={depth + 1} label="Spine" />
        ) : null}
        {region.spine.map((block, i) => (
          <BlockRow
            key={pathKey([...path, 'spine', i])}
            block={block}
            path={[...path, 'spine', i]}
            depth={depth + 1}
            selection={selection}
            expanded={expanded}
            toggle={toggle}
            onSelect={onSelect}
            variant="spine"
          />
        ))}
        {region.overlays.length > 0 ? (
          <Section depth={depth + 1} label="Overlays" />
        ) : null}
        {region.overlays.map((block, i) => (
          <BlockRow
            key={pathKey([...path, 'overlays', i])}
            block={block}
            path={[...path, 'overlays', i]}
            depth={depth + 1}
            selection={selection}
            expanded={expanded}
            toggle={toggle}
            onSelect={onSelect}
            variant="overlay"
          />
        ))}
      </>
    );
  }

  // split
  return (
    <>
      <Row
        path={path}
        depth={depth}
        icon={region.axis === 'h' ? '⇔' : '⇕'}
        label={`split (${region.axis})`}
        meta={`${region.children.length} children`}
        selected={isPathEqual(path, selection)}
        onSelect={onSelect}
      />
      {region.children.map((child, i) => (
        <RegionRows
          key={pathKey([...path, 'children', i, 'region'])}
          region={child.region}
          path={[...path, 'children', i, 'region']}
          depth={depth + 1}
          selection={selection}
          expanded={expanded}
          toggle={toggle}
          onSelect={onSelect}
        />
      ))}
    </>
  );
};

// ---------------------------------------------------------------------------
// Globals section
// ---------------------------------------------------------------------------

interface GlobalsProps {
  doc: TemplateDoc;
  selection: NodePath | null;
  onSelect: (path: NodePath) => void;
}

const GlobalsRows = ({ doc, selection, onSelect }: GlobalsProps) => {
  const rows: ReactNode[] = [];

  const narration = doc.globals.audio.narration;
  if (narration) {
    const path: NodePath = ['globals', 'audio', 'narration'];
    rows.push(
      <Row
        key={pathKey(path)}
        path={path}
        depth={1}
        icon="🎙"
        label="narration"
        meta={narration.source}
        selected={isPathEqual(path, selection)}
        onSelect={onSelect}
      />
    );
  }

  const music = doc.globals.audio.music;
  if (music) {
    const path: NodePath = ['globals', 'audio', 'music'];
    rows.push(
      <Row
        key={pathKey(path)}
        path={path}
        depth={1}
        icon="♪"
        label="music"
        meta={isSlot(music) ? slotKindLabel(music as Slot<unknown>) : '—'}
        dot={
          isSlot(music)
            ? slotDotColor(music as Slot<unknown>)
            : 'var(--fg-muted)'
        }
        selected={isPathEqual(path, selection)}
        onSelect={onSelect}
      />
    );
  }

  const captions = doc.globals.captions;
  if (captions) {
    const path: NodePath = ['globals', 'captions'];
    rows.push(
      <Row
        key={pathKey(path)}
        path={path}
        depth={1}
        icon="¶"
        label="captions"
        meta={captions.from}
        selected={isPathEqual(path, selection)}
        onSelect={onSelect}
      />
    );
  }

  if (rows.length === 0) return null;

  return (
    <>
      <Section depth={0} label="Globals" />
      {rows}
    </>
  );
};

// ---------------------------------------------------------------------------
// Outline pane
// ---------------------------------------------------------------------------

export const OutlinePane = () => {
  const doc = useEditorStore((s: OutlineStateSlice) => s.doc);
  const selection = useEditorStore((s: OutlineStateSlice) => s.selection);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const select = (path: NodePath) => {
    useEditorStore.getState().setSelection(path);
  };

  if (!doc) {
    return (
      <>
        <header className="pane-header">Outline</header>
        <div style={{ padding: 12, color: 'var(--fg-muted)' }}>
          No document loaded.
        </div>
      </>
    );
  }

  const docPath: NodePath = [];
  const rootPath: NodePath = ['root'];

  return (
    <>
      <header className="pane-header">Outline</header>
      <div style={{ paddingBottom: 12 }}>
        <Row
          path={docPath}
          depth={0}
          icon="◆"
          label={doc.id}
          meta={`v${doc.schemaVersion} · ${doc.duration.kind}`}
          selected={selection !== null && selection.length === 0}
          onSelect={select}
        />
        <RegionRows
          region={doc.root}
          path={rootPath}
          depth={1}
          selection={selection}
          expanded={expanded}
          toggle={toggle}
          onSelect={select}
        />
        <GlobalsRows doc={doc} selection={selection} onSelect={select} />
      </div>
    </>
  );
};
